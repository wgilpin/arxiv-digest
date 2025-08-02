import { Module } from '@nestjs/common';
import { GenerationService } from './generation/generation.service';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [LLMModule],
  providers: [GenerationService],
  exports: [GenerationService],
})
export class GenerationModule {}
