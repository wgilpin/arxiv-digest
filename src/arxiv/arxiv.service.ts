import { Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import * as xml2js from 'xml2js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ArxivService {
  private readonly ARXIV_API_URL = 'http://export.arxiv.org/api/query';
  private readonly genAI: GoogleGenerativeAI;
  private readonly CACHE_DIR = './cache';
  private readonly PDF_CACHE_DIR = path.join(this.CACHE_DIR, 'pdfs');
  private readonly TEXT_CACHE_DIR = path.join(this.CACHE_DIR, 'text');

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    this.ensureCacheDirectories();
  }

  /**
   * Ensures cache directories exist
   */
  private ensureCacheDirectories(): void {
    try {
      if (!fs.existsSync(this.CACHE_DIR)) {
        fs.mkdirSync(this.CACHE_DIR, { recursive: true });
      }
      if (!fs.existsSync(this.PDF_CACHE_DIR)) {
        fs.mkdirSync(this.PDF_CACHE_DIR, { recursive: true });
      }
      if (!fs.existsSync(this.TEXT_CACHE_DIR)) {
        fs.mkdirSync(this.TEXT_CACHE_DIR, { recursive: true });
      }
    } catch (error) {
      console.warn('Failed to create cache directories:', error);
    }
  }

  /**
   * Gets the cache file path for a PDF
   */
  private getPdfCachePath(arxivId: string): string {
    return path.join(this.PDF_CACHE_DIR, `${arxivId}.pdf`);
  }

  /**
   * Gets the cache file path for cleaned text
   */
  private getTextCachePath(arxivId: string): string {
    return path.join(this.TEXT_CACHE_DIR, `${arxivId}.txt`);
  }

  /**
   * Checks if a cached PDF exists and is recent (within 7 days)
   */
  private isCachedPdfValid(cachePath: string): boolean {
    try {
      if (!fs.existsSync(cachePath)) {
        return false;
      }
      const stats = fs.statSync(cachePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      return ageInDays < 7; // Cache for 7 days
    } catch {
      return false;
    }
  }

  /**
   * Checks if cached text exists and is recent (within 7 days)
   */
  private isCachedTextValid(cachePath: string): boolean {
    try {
      if (!fs.existsSync(cachePath)) {
        return false;
      }
      const stats = fs.statSync(cachePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      return ageInDays < 7; // Cache for 7 days
    } catch {
      return false;
    }
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
   * Retrieves the text of a paper given its ArXiv ID by uploading the PDF directly to Gemini.
   * Uses Gemini-2.0-flash for PDF text extraction and cleaning.
   * Implements caching for both PDFs and cleaned text.
   * @param arxivId The ArXiv ID of the paper.
   * @returns A promise that resolves to the paper's text.
   */
  async getPaperText(arxivId: string): Promise<string> {
    try {
      const textCachePath = this.getTextCachePath(arxivId);
      
      // Check if we have cached text
      if (this.isCachedTextValid(textCachePath)) {
        try {
          const cachedText = fs.readFileSync(textCachePath, 'utf-8');
          console.log(`Using cached text for ArXiv ID: ${arxivId}`);
          return cachedText;
        } catch (error) {
          console.warn('Failed to read cached text, will regenerate:', error);
        }
      }

      // Get PDF (from cache or download)
      const pdfBuffer = await this.getPdfBuffer(arxivId);

      // Upload PDF directly to Gemini for text extraction and cleaning
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
      });

      const prompt = `
Extract and clean the text from this academic paper PDF. 
Please:
- Extract all the text content from the PDF
- Remove page numbers, headers, footers, and formatting artifacts
- Preserve the logical structure including sections, paragraphs, and important content
- Make it readable while maintaining all the technical content
- Ensure mathematical formulas and technical terms are preserved

Return the cleaned, structured text that would be suitable for further analysis.
`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: pdfBuffer.toString('base64'),
            mimeType: 'application/pdf',
          },
        },
      ]);

      const cleanedText = result.response.text();

      // Cache the cleaned text
      if (cleanedText) {
        try {
          fs.writeFileSync(textCachePath, cleanedText, 'utf-8');
          console.log(`Cached cleaned text for ArXiv ID: ${arxivId}`);
        } catch (error) {
          console.warn('Failed to cache cleaned text:', error);
        }
      }

      return cleanedText || `Unable to extract text from ArXiv paper ${arxivId}`;
    } catch (error) {
      console.error(
        `Error extracting text from ArXiv paper ${arxivId}:`,
        error,
      );

      // Fallback: return a placeholder that includes the ArXiv ID for context
      return `Unable to extract full text from ArXiv paper ${arxivId}. This appears to be a research paper that would benefit from a comprehensive analysis of its key concepts and methodologies.`;
    }
  }

  /**
   * Gets PDF buffer from cache or downloads from ArXiv
   * @param arxivId The ArXiv ID of the paper
   * @returns A promise that resolves to the PDF buffer
   */
  private async getPdfBuffer(arxivId: string): Promise<Buffer> {
    const pdfCachePath = this.getPdfCachePath(arxivId);
    
    // Check if we have a cached PDF
    if (this.isCachedPdfValid(pdfCachePath)) {
      try {
        const cachedPdf = fs.readFileSync(pdfCachePath);
        console.log(`Using cached PDF for ArXiv ID: ${arxivId}`);
        return cachedPdf;
      } catch (error) {
        console.warn('Failed to read cached PDF, will re-download:', error);
      }
    }

    // Download PDF from ArXiv
    console.log(`Downloading PDF for ArXiv ID: ${arxivId}`);
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
    });

    const pdfBuffer = Buffer.from(response.data as ArrayBuffer);

    // Cache the PDF
    try {
      fs.writeFileSync(pdfCachePath, pdfBuffer);
      console.log(`Cached PDF for ArXiv ID: ${arxivId}`);
    } catch (error) {
      console.warn('Failed to cache PDF:', error);
    }

    return pdfBuffer;
  }
}
