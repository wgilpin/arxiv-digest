import { Module } from '@nestjs/common';
import { FigureExtractionService } from './figure-extraction.service';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [StorageModule, LLMModule],
  providers: [FigureExtractionService],
  exports: [FigureExtractionService],
})
export class FigureExtractionModule {}