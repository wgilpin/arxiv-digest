import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { PDFDocument } from 'pdf-lib';
import * as sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { FirebaseStorageService } from '../storage/storage.service';
import { LLMService } from '../llm/llm.service';
import { debugLog } from '../common/debug-logger';
import {
  ExtractedFigure,
  FigureExtractionResult,
  VisionAnalysisResult,
} from './interfaces/figure.interface';

@Injectable()
export class FigureExtractionService {
  constructor(
    private readonly storageService: FirebaseStorageService,
    private readonly llmService: LLMService,
  ) {}

  /**
   * Extracts figures from either HTML or PDF content
   */
  async extractFigures(
    arxivId: string,
    options: {
      htmlContent?: string;
      pdfBuffer?: Buffer;
      storeImages?: boolean;
    },
  ): Promise<FigureExtractionResult> {
    const { htmlContent, pdfBuffer, storeImages = true } = options;
    const errors: string[] = [];
    let figures: ExtractedFigure[] = [];
    let extractionMethod: 'html' | 'pdf-vision' | 'hybrid' = 'html';

    try {
      // Prefer HTML extraction if available
      if (htmlContent) {
        debugLog(`Extracting figures from HTML for ArXiv ID: ${arxivId}`);
        figures = await this.extractFiguresFromHtml(arxivId, htmlContent);
        extractionMethod = 'html';
      }

      // Fallback to PDF extraction if no HTML or no figures found
      if ((!figures || figures.length === 0) && pdfBuffer) {
        debugLog(`Falling back to PDF figure extraction for ArXiv ID: ${arxivId}`);
        figures = await this.extractFiguresFromPdf(arxivId, pdfBuffer);
        extractionMethod = figures.length > 0 ? 'pdf-vision' : extractionMethod;
      }

      // Store images if requested
      if (storeImages && figures.length > 0) {
        figures = await this.storeFigureImages(figures);
      }

      debugLog(`Extracted ${figures.length} figures using ${extractionMethod} method`);

      return {
        figures,
        totalFound: figures.length,
        extractionMethod,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error(`Error extracting figures for ArXiv ID ${arxivId}:`, error);
      errors.push(error.message);
      return {
        figures: [],
        totalFound: 0,
        extractionMethod,
        errors,
      };
    }
  }

  /**
   * Extracts figures from HTML content using cheerio
   */
  private async extractFiguresFromHtml(
    arxivId: string,
    htmlContent: string,
  ): Promise<ExtractedFigure[]> {
    const $ = cheerio.load(htmlContent);
    const figures: ExtractedFigure[] = [];

    // Look for figure elements with captions
    $('figure').each((index, element) => {
      const $figure = $(element);
      const $img = $figure.find('img').first();
      const $caption = $figure.find('figcaption').first();

      if ($img.length > 0) {
        const imgSrc = $img.attr('src');
        const altText = $img.attr('alt') || '';
        const captionText = $caption.text().trim() || altText;

        // Extract figure number from caption if available
        const figureNumberMatch = captionText.match(/Figure\s*(\d+\.?\d*)/i);
        const figureNumber = figureNumberMatch ? figureNumberMatch[1] : `${index + 1}`;

        const figure: ExtractedFigure = {
          id: uuidv4(),
          arxivId,
          figureNumber,
          caption: captionText,
          type: this.determineFigureType(captionText, altText),
          metadata: {
            extractionMethod: 'html',
            originalUrl: imgSrc,
          },
        };

        // If it's a relative URL, convert to absolute
        if (imgSrc && !imgSrc.startsWith('http') && figure.metadata) {
          figure.metadata.originalUrl = `https://arxiv.org${imgSrc}`;
        }

        figures.push(figure);
      }
    });

    // Also look for LaTeX figure environments in case they're rendered differently
    $('.ltx_figure').each((index, element) => {
      const $figure = $(element);
      const $img = $figure.find('img').first();
      const $caption = $figure.find('.ltx_caption').first();

      if ($img.length > 0 && !figures.some(f => f.metadata?.originalUrl === $img.attr('src'))) {
        const imgSrc = $img.attr('src');
        const captionText = $caption.text().trim();

        const figureNumberMatch = captionText.match(/Figure\s*(\d+\.?\d*)/i);
        const figureNumber = figureNumberMatch ? figureNumberMatch[1] : `${figures.length + 1}`;

        figures.push({
          id: uuidv4(),
          arxivId,
          figureNumber,
          caption: captionText,
          type: this.determineFigureType(captionText, ''),
          metadata: {
            extractionMethod: 'html',
            originalUrl: imgSrc?.startsWith('http') ? imgSrc : `https://arxiv.org${imgSrc}`,
          },
        });
      }
    });

    return figures;
  }

  /**
   * Extracts figures from PDF using Vision API
   */
  private async extractFiguresFromPdf(
    arxivId: string,
    pdfBuffer: Buffer,
  ): Promise<ExtractedFigure[]> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pages = pdfDoc.getPages();
      const allFigures: ExtractedFigure[] = [];

      // Process pages in batches to avoid overwhelming the API
      const batchSize = 5;
      for (let i = 0; i < pages.length; i += batchSize) {
        const batch = pages.slice(i, Math.min(i + batchSize, pages.length));
        const batchPromises = batch.map(async (page, batchIndex) => {
          const pageIndex = i + batchIndex;
          return this.analyzePdfPage(arxivId, pdfBuffer, pageIndex + 1);
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(result => {
          if (result && result.figures.length > 0) {
            allFigures.push(...result.figures);
          }
        });
      }

      return allFigures;
    } catch (error) {
      console.error('Error extracting figures from PDF:', error);
      return [];
    }
  }

  /**
   * Analyzes a single PDF page for figures using Vision API
   */
  private async analyzePdfPage(
    arxivId: string,
    pdfBuffer: Buffer,
    pageNumber: number,
  ): Promise<{ figures: ExtractedFigure[] }> {
    try {
      // Convert PDF page to image
      const pageImage = await this.renderPdfPageToImage(pdfBuffer, pageNumber);
      if (!pageImage) {
        return { figures: [] };
      }

      // Use Vision API to identify figures
      const prompt = `Analyze this academic paper page and identify all figures, charts, diagrams, and tables.

For each figure found, extract:
1. Figure number/label (e.g., "Figure 1", "Table 2")
2. Caption text (the descriptive text below/near the figure)
3. Figure type: chart, diagram, table, equation, or image
4. Approximate bounding box location (as percentages of page dimensions)

Return the results as a JSON array with this exact format:
{
  "figures": [
    {
      "figureNumber": "1",
      "caption": "The complete caption text here",
      "type": "chart",
      "boundingBox": {
        "x": 10,
        "y": 20,
        "width": 80,
        "height": 40
      },
      "confidence": 0.9
    }
  ]
}

If no figures are found, return: {"figures": []}`;

      const result = await this.llmService.generateContent({
        prompt,
        fileUpload: {
          data: pageImage,
          mimeType: 'image/png',
        },
      });

      const visionResult = this.parseVisionResponse(result.content);
      
      // Convert vision results to ExtractedFigure format
      const figures: ExtractedFigure[] = visionResult.figures.map(fig => ({
        id: uuidv4(),
        arxivId,
        pageNumber,
        figureNumber: fig.figureNumber,
        caption: fig.caption || '',
        type: this.mapFigureType(fig.type),
        boundingBox: fig.boundingBox,
        imageBuffer: pageImage, // Store the page image for later cropping
        metadata: {
          extractionMethod: 'pdf-vision',
          confidence: fig.confidence,
        },
      }));

      return { figures };
    } catch (error) {
      console.error(`Error analyzing PDF page ${pageNumber}:`, error);
      return { figures: [] };
    }
  }

  /**
   * Renders a PDF page to an image buffer
   */
  private async renderPdfPageToImage(
    pdfBuffer: Buffer,
    pageNumber: number,
  ): Promise<Buffer | null> {
    try {
      // For now, we'll use the entire PDF for vision analysis
      // In production, you'd want to use a proper PDF rendering library
      // like pdf2pic or pdfjs-dist to extract individual pages
      debugLog(`Would render page ${pageNumber} to image - using full PDF for now`);
      
      // This is a placeholder - in production you'd actually render the specific page
      // For MVP, we'll let Gemini Vision handle the full PDF
      return pdfBuffer;
    } catch (error) {
      console.error(`Error rendering PDF page ${pageNumber}:`, error);
      return null;
    }
  }

  /**
   * Crops figure from page image based on bounding box
   */
  private async cropFigureFromImage(
    pageImage: Buffer,
    boundingBox: { x: number; y: number; width: number; height: number },
  ): Promise<Buffer> {
    try {
      const image = sharp(pageImage);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error('Unable to get image dimensions');
      }

      // Convert percentage-based bounding box to pixels
      const cropArea = {
        left: Math.round((boundingBox.x / 100) * metadata.width),
        top: Math.round((boundingBox.y / 100) * metadata.height),
        width: Math.round((boundingBox.width / 100) * metadata.width),
        height: Math.round((boundingBox.height / 100) * metadata.height),
      };

      return await image
        .extract(cropArea)
        .png()
        .toBuffer();
    } catch (error) {
      console.error('Error cropping figure:', error);
      // Return original image if cropping fails
      return pageImage;
    }
  }

  /**
   * Stores figure images in Firebase Storage
   */
  private async storeFigureImages(figures: ExtractedFigure[]): Promise<ExtractedFigure[]> {
    const storedFigures = await Promise.all(
      figures.map(async (figure) => {
        try {
          let imageBuffer: Buffer | undefined;

          // If we have an original URL (from HTML), download it
          if (figure.metadata?.originalUrl && !figure.imageBuffer) {
            imageBuffer = await this.downloadImage(figure.metadata.originalUrl);
          }
          // If we have a buffer and bounding box, crop it
          else if (figure.imageBuffer && figure.boundingBox) {
            imageBuffer = await this.cropFigureFromImage(figure.imageBuffer, figure.boundingBox);
          }
          // Otherwise use the buffer as-is
          else if (figure.imageBuffer) {
            imageBuffer = figure.imageBuffer;
          }

          if (imageBuffer) {
            const storagePath = `arxiv/figures/${figure.arxivId}/${figure.id}.png`;
            const imageUrl = await this.storageService.uploadBuffer(storagePath, imageBuffer, {
              arxivId: figure.arxivId,
              figureNumber: figure.figureNumber || 'unknown',
              caption: figure.caption.slice(0, 200), // Limit caption length for metadata
            });

            // Remove buffer from returned object to save memory
            const { imageBuffer: _, ...figureWithoutBuffer } = figure;
            return {
              ...figureWithoutBuffer,
              imageUrl,
            };
          }

          return figure;
        } catch (error) {
          console.error(`Error storing figure ${figure.id}:`, error);
          return figure;
        }
      }),
    );

    return storedFigures;
  }

  /**
   * Downloads an image from a URL
   */
  private async downloadImage(url: string): Promise<Buffer | undefined> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error(`Error downloading image from ${url}:`, error);
      return undefined;
    }
  }

  /**
   * Parses Vision API response
   */
  private parseVisionResponse(response: string): VisionAnalysisResult {
    try {
      // Extract JSON from response
      let jsonString = response.trim();
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const result = JSON.parse(jsonString);
      return result as VisionAnalysisResult;
    } catch (error) {
      console.error('Error parsing vision response:', error);
      return { figures: [] };
    }
  }

  /**
   * Determines figure type from caption and alt text
   */
  private determineFigureType(
    caption: string,
    altText: string,
  ): ExtractedFigure['type'] {
    const text = `${caption} ${altText}`.toLowerCase();
    
    if (text.includes('table')) return 'table';
    if (text.includes('chart') || text.includes('graph') || text.includes('plot')) return 'chart';
    if (text.includes('diagram') || text.includes('flow') || text.includes('architecture')) return 'diagram';
    if (text.includes('equation') || text.includes('formula')) return 'equation';
    if (text.includes('image') || text.includes('photo')) return 'image';
    
    return 'unknown';
  }

  /**
   * Maps Vision API figure type to our type enum
   */
  private mapFigureType(type: string): ExtractedFigure['type'] {
    const typeMap: Record<string, ExtractedFigure['type']> = {
      'chart': 'chart',
      'diagram': 'diagram',
      'table': 'table',
      'equation': 'equation',
      'image': 'image',
    };
    
    return typeMap[type.toLowerCase()] || 'unknown';
  }
}