import { Injectable } from '@nestjs/common';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { LLMProvider, LLMRequest, LLMResponse } from '../interfaces/llm.interface';
import { debugLog } from '../../common/debug-logger';

@Injectable()
export class VercelUnifiedProvider implements LLMProvider {
  name = 'vercel-unified';
  private googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
  private xaiProvider: ReturnType<typeof createXai> | null = null;

  constructor() {
    // Initialize providers with API keys if available
    if (process.env.GEMINI_API_KEY) {
      this.googleProvider = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
    }

    // Support both XAI_API_KEY (standard) and GROK_API_KEY (for backwards compatibility)
    const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    if (xaiApiKey) {
      this.xaiProvider = createXai({
        apiKey: xaiApiKey,
      });
    }

    debugLog('Vercel Unified Provider initialized', {
      hasGemini: !!this.googleProvider,
      hasGrok: !!this.xaiProvider,
    });
  }

  private getModelProvider(modelName: string, allowFallback: boolean = false) {
    // Determine provider based on model name
    if (modelName.startsWith('gemini-')) {
      if (!this.googleProvider) {
        if (allowFallback && this.xaiProvider) {
          debugLog('Gemini not available, falling back to available Grok provider');
          return this.xaiProvider('grok-3-mini'); // Use default Grok model
        }
        throw new Error('Gemini API key not configured');
      }
      return this.googleProvider(modelName);
    } else if (modelName.startsWith('grok-')) {
      if (!this.xaiProvider) {
        if (allowFallback && this.googleProvider) {
          debugLog('Grok not available, falling back to available Gemini provider');
          return this.googleProvider('gemini-2.5-flash-lite'); // Use default Gemini model
        }
        throw new Error('Grok API key not configured');
      }
      return this.xaiProvider(modelName);
    } else {
      // For unknown models, try to use the first available provider
      if (this.googleProvider) {
        debugLog(`Unknown model ${modelName}, trying with Gemini provider`);
        return this.googleProvider('gemini-2.5-flash-lite');
      } else if (this.xaiProvider) {
        debugLog(`Unknown model ${modelName}, trying with Grok provider`);
        return this.xaiProvider('grok-3-mini');
      } else {
        throw new Error(`No providers available for model: ${modelName}`);
      }
    }
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    if (!this.isAvailable()) {
      throw new Error('No LLM providers configured');
    }

    const modelName = request.model || process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash-lite';
    
    try {
      const model = this.getModelProvider(modelName);

      debugLog(`Generating content with Vercel Unified provider, model: ${modelName}`);

      const generateConfig: any = {
        model,
        prompt: request.prompt,
        temperature: request.temperature ?? 0.7,
        system: request.systemPrompt,
      };

      if (request.maxTokens) {
        generateConfig.maxTokens = request.maxTokens;
      }

      const result = await generateText(generateConfig);

      return {
        content: result.text,
        usage: result.usage ? {
          inputTokens: (result.usage as any).promptTokens || 0,
          outputTokens: (result.usage as any).completionTokens || 0,
          totalTokens: (result.usage as any).totalTokens || 0,
        } : undefined,
        model: modelName,
      };
    } catch (error: any) {
      debugLog('Vercel Unified provider error:', error);
      
      // Try fallback with a different provider
      try {
        debugLog('Attempting fallback with alternative provider');
        const fallbackModel = this.getModelProvider(modelName, true);
        
        const generateConfig: any = {
          model: fallbackModel,
          prompt: request.prompt,
          temperature: request.temperature ?? 0.7,
          system: request.systemPrompt,
        };

        if (request.maxTokens) {
          generateConfig.maxTokens = request.maxTokens;
        }

        const result = await generateText(generateConfig);

        return {
          content: result.text,
          usage: result.usage ? {
            inputTokens: (result.usage as any).promptTokens || 0,
            outputTokens: (result.usage as any).completionTokens || 0,
            totalTokens: (result.usage as any).totalTokens || 0,
          } : undefined,
          model: modelName,
        };
      } catch (fallbackError: any) {
        debugLog('Fallback also failed:', fallbackError);
        throw error; // Throw original error
      }
    }
  }

  streamContent(request: LLMRequest) {
    if (!this.isAvailable()) {
      throw new Error('No LLM providers configured');
    }

    const modelName = request.model || process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash-lite';
    
    try {
      const model = this.getModelProvider(modelName);

      debugLog(`Streaming content with Vercel Unified provider, model: ${modelName}`);

      const streamConfig: any = {
        model,
        prompt: request.prompt,
        temperature: request.temperature ?? 0.7,
        system: request.systemPrompt,
      };

      if (request.maxTokens) {
        streamConfig.maxTokens = request.maxTokens;
      }

      return streamText(streamConfig);
    } catch (error: any) {
      debugLog('Vercel Unified provider streaming error:', error);
      
      // Try fallback with a different provider
      try {
        debugLog('Attempting streaming fallback with alternative provider');
        const fallbackModel = this.getModelProvider(modelName, true);
        
        const streamConfig: any = {
          model: fallbackModel,
          prompt: request.prompt,
          temperature: request.temperature ?? 0.7,
          system: request.systemPrompt,
        };

        if (request.maxTokens) {
          streamConfig.maxTokens = request.maxTokens;
        }

        return streamText(streamConfig);
      } catch (fallbackError: any) {
        debugLog('Streaming fallback also failed:', fallbackError);
        throw error; // Throw original error
      }
    }
  }

  isAvailable(): boolean {
    return !!(this.googleProvider || this.xaiProvider);
  }
}