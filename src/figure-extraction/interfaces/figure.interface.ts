export interface ExtractedFigure {
  id: string;
  arxivId: string;
  pageNumber?: number;
  figureNumber?: string;
  caption: string;
  type: 'chart' | 'diagram' | 'table' | 'equation' | 'image' | 'unknown';
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  imageUrl?: string;
  imageBuffer?: Buffer;
  metadata?: {
    extractionMethod: 'html' | 'pdf-vision' | 'pdf-embedded';
    confidence?: number;
    originalUrl?: string;
  };
}

export interface FigureExtractionResult {
  figures: ExtractedFigure[];
  totalFound: number;
  extractionMethod: 'html' | 'pdf-vision' | 'hybrid';
  errors?: string[];
}

export interface VisionAnalysisResult {
  figures: Array<{
    figureNumber?: string;
    caption?: string;
    type: string;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
  }>;
}