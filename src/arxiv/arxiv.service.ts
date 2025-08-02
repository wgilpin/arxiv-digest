import { Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import * as xml2js from 'xml2js';
import { FirebaseStorageService } from '../storage/storage.service';
import * as cheerio from 'cheerio';
import { debugLog } from 'src/common/debug-logger';
import { LLMService } from '../llm/llm.service';

@Injectable()
export class ArxivService {
  private readonly ARXIV_API_URL = 'http://export.arxiv.org/api/query';

  constructor(
    private readonly storageService: FirebaseStorageService,
    private readonly llmService: LLMService,
  ) {}

  /**
   * Gets storage paths for ArXiv files
   */
  private getArxivStoragePaths(arxivId: string) {
    return this.storageService.generateArxivPaths(arxivId);
  }

  /**
   * Checks if an ArXiv paper has an HTML version available
   */
  private async checkHtmlAvailable(arxivId: string): Promise<boolean> {
    try {
      // Try the most common pattern first: v1
      const htmlUrl = `https://arxiv.org/html/${arxivId}v1`;
      const response = await axios.head(htmlUrl, { timeout: 10000 });
      return response.status === 200;
    } catch (error) {
      // If v1 doesn't work, try without version suffix
      try {
        const htmlUrl = `https://arxiv.org/html/${arxivId}`;
        const response = await axios.head(htmlUrl, { timeout: 10000 });
        return response.status === 200;
      } catch (error) {
        // No HTML version available
        return false;
      }
    }
  }


  /**
   * Extracts and cleans text content from HTML using cheerio
   */
  private extractTextFromHtml($: cheerio.Root, arxivId: string): string | null {
    try {
      // Extract content from the main article tag
      const articleContent = $('article').first();
      
      if (articleContent.length === 0) {
        console.warn(`No article tag found in HTML for ArXiv ID: ${arxivId}`);
        return null;
      }

      // Remove script tags, style tags, and other non-content elements
      articleContent.find('script, style, nav, .ltx_navigation, .ltx_page_footer, .ltx_page_header').remove();
      
      // Extract text content while preserving structure
      let extractedText = '';
      
      // Process different elements to maintain structure
      articleContent.find('h1, h2, h3, h4, h5, h6').each((_, element) => {
        const $el = $(element);
        extractedText += `\n\n## ${$el.text().trim()}\n\n`;
      });
      
      articleContent.find('p').each((_, element) => {
        const $el = $(element);
        const text = $el.text().trim();
        if (text) {
          extractedText += `${text}\n\n`;
        }
      });
      
      // Handle mathematical expressions
      articleContent.find('.ltx_Math, .ltx_equation, .ltx_eqn_table').each((_, element) => {
        const $el = $(element);
        const mathText = $el.text().trim();
        if (mathText) {
          extractedText += `${mathText}\n\n`;
        }
      });
      
      // Handle lists
      articleContent.find('ul, ol').each((_, element) => {
        const $el = $(element);
        $el.find('li').each((_, li) => {
          const $li = $(li);
          extractedText += `• ${$li.text().trim()}\n`;
        });
        extractedText += '\n';
      });
      
      // If we didn't get much structured content, fall back to simple text extraction
      if (extractedText.trim().length < 500) {
        extractedText = articleContent.text();
      }
      
      // Clean up extra whitespace
      extractedText = extractedText
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines to double
        .replace(/^\s+|\s+$/g, '') // Trim start/end
        .trim();

      debugLog(`Extracted ${extractedText.length} characters from HTML for ArXiv ID: ${arxivId}`);
      return extractedText;
      
    } catch (error) {
      console.error(`Failed to extract text from HTML for ArXiv ID: ${arxivId}`, error);
      return null;
    }
  }

  /**
   * Extracts ArXiv ID from either a URL or ID string (public method)
   * @param input ArXiv URL (e.g., https://arxiv.org/abs/2507.11768) or ID (e.g., 2507.11768)
   * @returns The extracted ArXiv ID
   * @throws Error if the input is not a valid ArXiv URL or ID
   */
  public extractArxivId(input: string): string {
    return this.extractArxivIdInternal(input);
  }

  /**
   * Extracts ArXiv ID from either a URL or ID string
   * @param input ArXiv URL (e.g., https://arxiv.org/abs/2507.11768) or ID (e.g., 2507.11768)
   * @returns The extracted ArXiv ID
   * @throws Error if the input is not a valid ArXiv URL or ID
   */
  private extractArxivIdInternal(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new Error('Invalid input: must be a non-empty string');
    }

    const trimmedInput = input.trim();

    // Check if it's a URL
    if (trimmedInput.includes('arxiv.org')) {
      // Match various ArXiv URL formats:
      // https://arxiv.org/abs/2507.11768
      // http://arxiv.org/abs/2507.11768
      // arxiv.org/abs/2507.11768
      // https://arxiv.org/pdf/2507.11768.pdf
      // https://arxiv.org/abs/math.GT/0309136
      const urlMatch = trimmedInput.match(
        /arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?(?:\?|#|$)/i,
      );

      if (urlMatch && urlMatch[1]) {
        return urlMatch[1].trim();
      } else {
        throw new Error(`Invalid ArXiv URL format: ${input}`);
      }
    }

    // If it's not a URL, validate it as an ArXiv ID
    // ArXiv IDs can be in formats like:
    // - 2507.11768 (new format: YYMM.NNNNN)
    // - 1234.5678v1 (with version)
    // - math.GT/0309136 (old format with subcategory)
    // - hep-th/9901001 (old format)
    // - cond-mat.mes-hall/0309136v2 (old format with subcategory and version)
    const idPattern =
      /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)$/i;

    if (idPattern.test(trimmedInput)) {
      return trimmedInput;
    }

    throw new Error(
      `Invalid ArXiv ID format: ${input}. Expected formats: '2507.11768', 'math.GT/0309136', or ArXiv URL`,
    );
  }

  /**
   * Fetches the title of a paper from ArXiv.
   * @param arxivInput The ArXiv ID or URL of the paper.
   * @returns A promise that resolves to the paper's title.
   */
  async fetchPaperTitle(arxivInput: string): Promise<string> {
    const arxivId = this.extractArxivIdInternal(arxivInput);
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
   * Retrieves the text of a paper given its ArXiv ID or URL.
   * Prefers HTML version when available, falls back to PDF extraction via Gemini.
   * Uses Gemini-2.0-flash for PDF text extraction and cleaning.
   * Implements caching for both PDFs, HTML, and cleaned text.
   * @param arxivInput The ArXiv ID or URL of the paper.
   * @returns A promise that resolves to the paper's text.
   */
  async getPaperText(arxivInput: string): Promise<string> {
    const arxivId = this.extractArxivIdInternal(arxivInput);
    try {
      const paths = this.getArxivStoragePaths(arxivId);

      // Check if we have cached text in Firebase Storage
      if (await this.storageService.isCacheValid(paths.text, 24 * 30)) { // 30 days cache for text
        try {
          const cachedText = await this.storageService.downloadText(paths.text);
          debugLog(`Using cached text from Firebase Storage for ArXiv ID: ${arxivId}`);
          return cachedText;
        } catch (error) {
          console.warn('Failed to read cached text from Firebase Storage, will regenerate:', error);
        }
      }

      let extractedText: string | null = null;
      let extractionSource = '';

      // Check if HTML version is available for download
      const htmlAvailable = await this.checkHtmlAvailable(arxivId);
      if (htmlAvailable) {
        debugLog(`HTML version available for ArXiv ID: ${arxivId}, downloading...`);
        
        // Download raw HTML (don't cache - always available on ArXiv)
        let htmlUrl = `https://arxiv.org/html/${arxivId}v1`;
        let response;
        
        try {
          response = await axios.get(htmlUrl, { timeout: 30000 });
        } catch (error) {
          // Try without version suffix
          htmlUrl = `https://arxiv.org/html/${arxivId}`;
          response = await axios.get(htmlUrl, { timeout: 30000 });
        }

        const rawHtml = response.data;
        debugLog(`Downloaded HTML content for ArXiv ID: ${arxivId}`);
        
        // Extract text from HTML
        const $ = cheerio.load(rawHtml);
        extractedText = this.extractTextFromHtml($, arxivId);
        extractionSource = 'html';
      }

      // If HTML extraction failed or wasn't available, fall back to PDF
      if (!extractedText) {
        debugLog(`Falling back to PDF extraction for ArXiv ID: ${arxivId}`);
        
        // Get PDF (from cache or download)
        const pdfBuffer = await this.getPdfBuffer(arxivId);

        // Use LLM service for text extraction and cleaning
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

        const result = await this.llmService.extractPdf({
          prompt,
          fileUpload: {
            data: pdfBuffer,
            mimeType: 'application/pdf',
          },
        });

        extractedText = result.content;
        extractionSource = 'gemini-2.0-flash';
      }

      // Cache the final extracted text to Firebase Storage
      if (extractedText) {
        try {
          await this.storageService.uploadText(paths.text, extractedText, {
            arxivId: arxivId,
            extractedAt: new Date().toISOString(),
            source: extractionSource
          });
          debugLog(`Cached cleaned text to Firebase Storage for ArXiv ID: ${arxivId} (source: ${extractionSource})`);
        } catch (error) {
          console.warn('Failed to cache cleaned text to Firebase Storage:', error);
        }
      }

      return (
        extractedText || `Unable to extract text from ArXiv paper ${arxivId}`
      );
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
   * Downloads PDF from ArXiv (no caching - PDFs are always available on ArXiv)
   * @param arxivId The ArXiv ID of the paper
   * @returns A promise that resolves to the PDF buffer
   */
  private async getPdfBuffer(arxivId: string): Promise<Buffer> {
    // Download PDF from ArXiv (don't cache - it's always available)
    debugLog(`Downloading PDF for ArXiv ID: ${arxivId}`);
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
    });

    return Buffer.from(response.data as ArrayBuffer);
  }
}
