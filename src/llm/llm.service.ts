import { Injectable } from '@nestjs/common';
import { LLMProvider, LLMRequest, LLMResponse, LLMProviderType, ModelUsage } from './interfaces/llm.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { GrokProvider } from './providers/grok.provider';
import { ModelSelectorService } from './model-selector.service';
import { debugLog } from '../common/debug-logger';

@Injectable()
export class LLMService {
  private providers: Map<LLMProviderType, LLMProvider> = new Map();
  private defaultProvider: LLMProviderType = LLMProviderType.GEMINI;

  constructor(
    private readonly geminiProvider: GeminiProvider,
    private readonly grokProvider: GrokProvider,
    private readonly modelSelector: ModelSelectorService,
  ) {
    this.providers.set(LLMProviderType.GEMINI, geminiProvider);
    this.providers.set(LLMProviderType.GROK, grokProvider);
    
    // Set default provider based on environment or availability
    const envProvider = process.env.LLM_DEFAULT_PROVIDER as LLMProviderType;
    if (envProvider && this.providers.has(envProvider)) {
      this.defaultProvider = envProvider;
    }

    debugLog('LLM Service initialized with providers:', Array.from(this.providers.keys()));
    debugLog('Default provider:', this.defaultProvider);
  }

  async generateContent(
    request: LLMRequest, 
    providerType?: LLMProviderType
  ): Promise<LLMResponse> {
    const targetProvider = providerType || this.defaultProvider;
    
    debugLog('Generating content with provider:', targetProvider, {
      promptLength: request.prompt.length,
      model: request.model
    });

    try {
      const provider = this.getProvider(providerType);
      return await provider.generateContent(request);
    } catch (error) {
      debugLog(`Provider '${targetProvider}' failed, attempting fallback:`, error.message);
      
      // Try fallback to other available providers
      for (const [type, fallbackProvider] of this.providers.entries()) {
        if (type !== targetProvider && fallbackProvider.isAvailable()) {
          debugLog(`Falling back to provider: ${type}`);
          try {
            return await fallbackProvider.generateContent(request);
          } catch (fallbackError) {
            debugLog(`Fallback provider '${type}' also failed:`, fallbackError.message);
          }
        }
      }
      
      // If all providers fail, throw the original error
      throw error;
    }
  }

  private getProvider(providerType?: LLMProviderType): LLMProvider {
    const targetProvider = providerType || this.defaultProvider;
    const provider = this.providers.get(targetProvider);
    
    if (!provider) {
      throw new Error(`LLM provider '${targetProvider}' not found`);
    }
    
    if (!provider.isAvailable()) {
      debugLog(`Provider '${targetProvider}' not available, falling back to default`);
      
      // Try fallback to available provider
      for (const [type, fallbackProvider] of this.providers.entries()) {
        if (fallbackProvider.isAvailable()) {
          debugLog(`Using fallback provider: ${type}`);
          return fallbackProvider;
        }
      }
      
      throw new Error(`No available LLM providers found`);
    }
    
    return provider;
  }

  getAvailableProviders(): LLMProviderType[] {
    return Array.from(this.providers.entries())
      .filter(([, provider]) => provider.isAvailable())
      .map(([type]) => type);
  }

  setDefaultProvider(providerType: LLMProviderType): void {
    if (!this.providers.has(providerType)) {
      throw new Error(`Provider '${providerType}' not registered`);
    }
    this.defaultProvider = providerType;
    debugLog('Default provider changed to:', providerType);
  }

  registerProvider(type: LLMProviderType, provider: LLMProvider): void {
    this.providers.set(type, provider);
    debugLog('Provider registered:', type);
  }

  // Convenience methods for specific usage types
  async generateContentForUsage(
    request: Omit<LLMRequest, 'model'>,
    usage: ModelUsage
  ): Promise<LLMResponse> {
    const provider = this.modelSelector.getProviderForUsage(usage);
    const model = this.modelSelector.getModelForUsage(usage, provider);
    
    this.modelSelector.logModelSelection(usage, provider);
    
    return this.generateContent(
      { ...request, model },
      provider
    );
  }

  async extractPdf(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return this.generateContentForUsage(request, ModelUsage.PDF_EXTRACTION);
  }

  async extractConcepts(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return this.generateContentForUsage(request, ModelUsage.CONCEPT_EXTRACTION);
  }

  async generateLessonTitles(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return this.generateContentForUsage(request, ModelUsage.LESSON_TITLES);
  }

  async generateLesson(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return this.generateContentForUsage(request, ModelUsage.LESSON_GENERATION);
  }
}