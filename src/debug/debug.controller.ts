import { Controller, Delete, Param, Post } from '@nestjs/common';
import { ArxivService } from '../arxiv/arxiv.service';

@Controller('debug')
export class DebugController {
  constructor(private readonly arxivService: ArxivService) {}

  /**
   * Clear figure cache for a specific ArXiv paper
   */
  @Delete('figures/:arxivId')
  async clearFigureCache(@Param('arxivId') arxivId: string) {
    try {
      await this.arxivService.clearFigureCache(arxivId);
      return { 
        success: true, 
        message: `Figure cache cleared for ArXiv ID: ${arxivId}` 
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to clear figure cache: ${error.message}` 
      };
    }
  }

  /**
   * Force re-extract figures for a paper
   */
  @Post('figures/:arxivId/extract')
  async forceExtractFigures(@Param('arxivId') arxivId: string) {
    try {
      const figures = await this.arxivService.getExtractedFigures(arxivId, true);
      return { 
        success: true, 
        message: `Re-extracted ${figures.length} figures for ArXiv ID: ${arxivId}`,
        figures: figures.map(f => ({ 
          id: f.id, 
          figureNumber: f.figureNumber, 
          caption: f.caption,
          imageUrl: f.imageUrl 
        }))
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to re-extract figures: ${error.message}` 
      };
    }
  }
}