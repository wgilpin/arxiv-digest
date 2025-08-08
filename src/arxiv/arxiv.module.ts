import { Module } from '@nestjs/common';
import { ArxivService } from './arxiv.service';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';
import { FigureExtractionModule } from '../figure-extraction/figure-extraction.module';

@Module({
  imports: [StorageModule, LLMModule, FigureExtractionModule],
  providers: [ArxivService],
  exports: [ArxivService],
})
export class ArxivModule {}
