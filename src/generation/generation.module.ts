import { Module } from '@nestjs/common';
import { GenerationService } from './generation/generation.service';
import { LLMModule } from '../llm/llm.module';
import { ArxivModule } from '../arxiv/arxiv.module';

@Module({
  imports: [LLMModule, ArxivModule],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
