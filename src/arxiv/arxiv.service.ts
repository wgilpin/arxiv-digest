import { Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import * as xml2js from 'xml2js';
import * as pdfParse from 'pdf-parse';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class ArxivService {
  private readonly ARXIV_API_URL = 'http://export.arxiv.org/api/query';
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  /**
   * Fetches the title of a paper from ArXiv.
   * @param arxivId The ArXiv ID of the paper.
   * @returns A promise that resolves to the paper's title.
   */
  async fetchPaperTitle(arxivId: string): Promise<string> {
    try {
      const response = await axios.get(this.ARXIV_API_URL, {
        params: {
          id_list: arxivId,
        },
        responseType: 'text',
        transformResponse: [(data: string) => data], // Prevent JSON parsing
      });

      const parser = new xml2js.Parser({ explicitArray: false });
      const result = (await parser.parseStringPromise(
        response.data as string,
      )) as {
        feed: {
          entry?: {
            title?: string;
          };
        };
      };

      const entry = result.feed.entry;
      if (entry && entry.title) {
        return entry.title;
      }
      throw new NotFoundException(
        `Could not find a paper with ID ${arxivId} on ArXiv.`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error(
        `Error fetching paper title for ID ${arxivId}:`,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw new NotFoundException(
        `Could not find a paper with ID ${arxivId} on ArXiv.`,
      );
    }
  }

  /**
   * Retrieves the text of a paper given its ArXiv ID by downloading and parsing the PDF.
   * Uses Gemini-2.0-flash for enhanced text extraction.
   * @param arxivId The ArXiv ID of the paper.
   * @returns A promise that resolves to the paper's text.
   */
  async getPaperText(arxivId: string): Promise<string> {
    try {
      // Download PDF from ArXiv
      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
      });

      // Parse PDF to extract raw text
      const pdfBuffer = Buffer.from(response.data as ArrayBuffer);
      const pdfData = await pdfParse(pdfBuffer);
      const rawText = pdfData.text;

      // Use Gemini-2.0-flash to clean and structure the text
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
      });

      const prompt = `
Please clean and structure this raw PDF text from an academic paper. 
Remove page numbers, headers, footers, and formatting artifacts.
Preserve the logical structure including sections, paragraphs, and important content.
Make it readable while maintaining all the technical content.

Raw text:
${rawText.slice(0, 50000)} // Limit to first 50k chars to avoid token limits
`;

      const result = await model.generateContent(prompt);
      const cleanedText = result.response.text();

      return cleanedText || rawText; // Fallback to raw text if cleaning fails
    } catch (error) {
      console.error(
        `Error extracting text from ArXiv paper ${arxivId}:`,
        error,
      );

      // Fallback: return a placeholder that includes the ArXiv ID for context
      return `Unable to extract full text from ArXiv paper ${arxivId}. This appears to be a research paper that would benefit from a comprehensive analysis of its key concepts and methodologies.`;
    }
  }
}
