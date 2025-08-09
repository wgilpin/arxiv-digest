import { Injectable } from '@nestjs/common';
import { LLMRequest, LLMResponse, LLMProviderType, ModelUsage } from './interfaces/llm.interface';
import { VercelUnifiedProvider } from './providers/vercel-unified.provider';
import { ModelSelectorService } from './model-selector.service';
import { debugLog } from '../common/debug-logger';
import { traceable } from "langsmith/traceable";

@Injectable()
export class VercelLLMService {
  private tokenUsageByModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> = {};

  constructor(
    private readonly unifiedProvider: VercelUnifiedProvider,
    private readonly modelSelector: ModelSelectorService,
  ) {
    debugLog('Vercel LLM Service initialized with unified provider');
  }

  async generateContent(
    request: LLMRequest, 
    providerType?: LLMProviderType,
    usage?: ModelUsage
  ): Promise<LLMResponse> {
    return traceable(async (request: LLMRequest, _providerType?: LLMProviderType) => {
      // Determine model based on usage
      let modelName = request.model;
      
      if (usage) {
        const targetProvider = this.modelSelector.getProviderForUsage(usage);
        modelName = this.modelSelector.getModelForUsage(usage, targetProvider);
      }

      // Override request model with selected model
      const enhancedRequest = {
        ...request,
        model: modelName || request.model
      };
      
      debugLog('Generating content with Vercel unified provider:', {
        promptLength: enhancedRequest.prompt.length,
        model: enhancedRequest.model,
        usage
      });

      try {
        const result = await this.unifiedProvider.generateContent(enhancedRequest);
        
        // Track token usage
        this.trackTokenUsage(result, enhancedRequest.model || 'unknown');
        
        return result;
      } catch (error: any) {
        debugLog(`Vercel unified provider failed:`, error.message);
        throw error;
      }
    }, { run_type: "llm" })(request, providerType);
  }

  streamContent(
    request: LLMRequest,
    _providerType?: LLMProviderType,
    usage?: ModelUsage
  ) {
    // Determine model based on usage
    let modelName = request.model;
    
    if (usage) {
      const targetProvider = this.modelSelector.getProviderForUsage(usage);
      modelName = this.modelSelector.getModelForUsage(usage, targetProvider);
    }

    // Override request model with selected model
    const enhancedRequest = {
      ...request,
      model: modelName || request.model
    };
    
    debugLog('Streaming content with Vercel unified provider:', {
      promptLength: enhancedRequest.prompt.length,
      model: enhancedRequest.model,
      usage
    });

    return this.unifiedProvider.streamContent(enhancedRequest);
  }

  isAvailable(): boolean {
    return this.unifiedProvider.isAvailable();
  }

  // Convenience methods for specific usage types
  async generateContentForUsage(
    request: Omit<LLMRequest, 'model'>,
    usage: ModelUsage
  ): Promise<LLMResponse> {
    return this.generateContent(request, undefined, usage);
  }

  async streamContentForUsage(
    request: Omit<LLMRequest, 'model'>,
    usage: ModelUsage
  ) {
    return this.streamContent(request, undefined, usage);
  }

  async extractPdf(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return traceable(async (request: Omit<LLMRequest, 'model'>) => {
      // PDF extraction requires file upload capability, currently only available with Gemini
      try {
        return this.generateContentForUsage(request, ModelUsage.PDF_EXTRACTION);
      } catch (error: any) {
        debugLog('PDF extraction failed, this may be due to network issues with Gemini API');
        throw new Error(`PDF extraction failed: ${error.message}. Please try again later or use a different input method.`);
      }
    }, { run_type: "llm" })(request);
  }

  async extractConcepts(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return traceable(async (request: Omit<LLMRequest, 'model'>) => {
      return this.generateContentForUsage(request, ModelUsage.CONCEPT_EXTRACTION);
    }, { run_type: "llm" })(request);
  }

  async generateLessonTitles(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return traceable(async (request: Omit<LLMRequest, 'model'>) => {
      return this.generateContentForUsage(request, ModelUsage.LESSON_TITLES);
    }, { run_type: "llm" })(request);
  }

  async generateLesson(request: Omit<LLMRequest, 'model'>): Promise<LLMResponse> {
    return traceable(async (request: Omit<LLMRequest, 'model'>) => {
      return this.generateContentForUsage(request, ModelUsage.LESSON_GENERATION);
    }, { run_type: "llm" })(request);
  }

  async streamLesson(request: Omit<LLMRequest, 'model'>) {
    return this.streamContentForUsage(request, ModelUsage.LESSON_GENERATION);
  }

  /**
   * Tracks token usage from an LLM response for a specific model
   */
  private trackTokenUsage(result: LLMResponse, modelName: string): void {
    const usage = result.usage;
    if (usage) {
      if (!this.tokenUsageByModel[modelName]) {
        this.tokenUsageByModel[modelName] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      }
      
      // Handle different response formats from different providers
      const inputTokens = usage.promptTokenCount || usage.inputTokens || usage.prompt_tokens || 0;
      const outputTokens = usage.candidatesTokenCount || usage.outputTokens || usage.completion_tokens || 0;
      const totalTokens = usage.totalTokenCount || usage.totalTokens || usage.total_tokens || inputTokens + outputTokens;
      
      this.tokenUsageByModel[modelName].inputTokens += inputTokens;
      this.tokenUsageByModel[modelName].outputTokens += outputTokens;
      this.tokenUsageByModel[modelName].totalTokens += totalTokens;
      
      debugLog(`Token usage tracked for ${modelName}:`, {
        inputTokens,
        outputTokens,
        totalTokens,
        runningTotal: this.tokenUsageByModel[modelName]
      });
    } else {
      debugLog(`No token usage information available for model: ${modelName}`);
    }
  }

  /**
   * Gets the current token usage by model without resetting the counters
   */
  getTokenUsage(): Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> {
    return { ...this.tokenUsageByModel };
  }

  /**
   * Gets the current token usage by model and resets the counters
   */
  getAndResetTokenUsage(): Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> {
    const usage = { ...this.tokenUsageByModel };
    this.tokenUsageByModel = {};
    debugLog('Token usage retrieved and reset:', usage);
    return usage;
  }

  /**
   * Resets token usage counters
   */
  resetTokenUsage(): void {
    this.tokenUsageByModel = {};
    debugLog('Token usage counters reset');
  }
}