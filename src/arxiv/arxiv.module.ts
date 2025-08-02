import { Module } from '@nestjs/common';
import { ArxivService } from './arxiv.service';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [StorageModule, LLMModule],
  providers: [ArxivService],
  exports: [ArxivService],
})
export class ArxivModule {}
