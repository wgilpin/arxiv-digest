import { Injectable } from '@nestjs/common';
import { LLMProviderType, ModelUsage } from './interfaces/llm.interface';
import { debugLog } from '../common/debug-logger';

@Injectable()
export class ModelSelectorService {
  private readonly defaultProvider: LLMProviderType;

  constructor() {
    this.defaultProvider = (process.env.LLM_DEFAULT_PROVIDER as LLMProviderType) || LLMProviderType.GEMINI;
    debugLog('ModelSelectorService initialized with default provider:', this.defaultProvider);
  }

  getModelForUsage(usage: ModelUsage, provider?: LLMProviderType): string {
    const targetProvider = provider || this.defaultProvider;
    
    switch (usage) {
      case ModelUsage.PDF_EXTRACTION:
        // PDF extraction always uses Gemini (only provider that supports file uploads currently)
        return process.env.GEMINI_PDF_EXTRACTION_MODEL || 'gemini-1.5-flash';

      case ModelUsage.CONCEPT_EXTRACTION:
      case ModelUsage.LESSON_TITLES:
        return this.getLargeModel(targetProvider);

      case ModelUsage.LESSON_GENERATION:
        return this.getFastModel(targetProvider);

      default:
        debugLog('Unknown model usage:', usage, 'falling back to fast model');
        return this.getFastModel(targetProvider);
    }
  }

  private getLargeModel(provider: LLMProviderType): string {
    switch (provider) {
      case LLMProviderType.GROK:
        return process.env.GROK_LARGE_MODEL || 'grok-3-mini';
      case LLMProviderType.GEMINI:
      default:
        return process.env.GEMINI_LARGE_MODEL || 'gemini-2.0-flash-experimental';
    }
  }

  private getFastModel(provider: LLMProviderType): string {
    switch (provider) {
      case LLMProviderType.GROK:
        return process.env.GROK_FAST_MODEL || 'grok-3-mini';
      case LLMProviderType.GEMINI:
      default:
        return process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash-lite';
    }
  }

  getProviderForUsage(usage: ModelUsage): LLMProviderType {
    switch (usage) {
      case ModelUsage.PDF_EXTRACTION:
        // PDF extraction must use Gemini (only provider with file upload support)
        return LLMProviderType.GEMINI;
      default:
        return this.defaultProvider;
    }
  }

  logModelSelection(usage: ModelUsage, provider?: LLMProviderType): void {
    const targetProvider = provider || this.getProviderForUsage(usage);
    const model = this.getModelForUsage(usage, targetProvider);
    debugLog(`Model selection for ${usage}:`, {
      provider: targetProvider,
      model: model
    });
  }
}