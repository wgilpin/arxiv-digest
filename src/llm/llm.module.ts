import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { GeminiProvider } from './providers/gemini.provider';
import { GrokProvider } from './providers/grok.provider';
import { ModelSelectorService } from './model-selector.service';

@Module({
  providers: [
    LLMService,
    GeminiProvider,
    GrokProvider,
    ModelSelectorService,
  ],
  exports: [LLMService, ModelSelectorService],
})
export class LLMModule {}