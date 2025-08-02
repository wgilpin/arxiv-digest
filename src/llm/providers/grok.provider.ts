import { Injectable } from '@nestjs/common';
import { LLMProvider, LLMRequest, LLMResponse } from '../interfaces/llm.interface';
import { debugLog } from '../../common/debug-logger';
import axios from 'axios';

@Injectable()
export class GrokProvider implements LLMProvider {
  public readonly name = 'grok';
  private defaultModel = 'grok-3-mini';
  private baseURL = 'https://api.x.ai/v1';

  constructor() {
    // Grok uses OpenAI-compatible API format
    if (!process.env.GROK_API_KEY) {
      debugLog('GROK_API_KEY not found in environment variables');
    }
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    debugLog('Grok provider generating content with request:', {
      promptLength: request.prompt.length,
      model: request.model || this.defaultModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasFileUpload: !!request.fileUpload
    });

    try {
      if (request.fileUpload) {
        throw new Error('Grok provider does not support file uploads yet');
      }

      const messages = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const requestBody: any = {
        model: request.model || this.defaultModel,
        messages,
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens || 8192,
      };

      // Add reasoning_effort for grok-3-mini and other reasoning models
      if ((request.model || this.defaultModel).includes('grok-3') || request.reasoningEffort) {
        requestBody.reasoning_effort = request.reasoningEffort || 'high';
      }

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const completion = response.data;
      const content = completion.choices[0].message.content;

      debugLog('Grok provider response received:', {
        contentLength: content.length,
        model: request.model || this.defaultModel,
        usage: completion.usage
      });

      return {
        content,
        model: request.model || this.defaultModel,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
      };
    } catch (error) {
      debugLog('Grok provider error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: error.config?.headers ? { ...error.config.headers, Authorization: '[REDACTED]' } : undefined
        }
      });
      
      if (error.response) {
        const errorMessage = error.response.data?.error?.message || 
                           error.response.data?.message || 
                           `HTTP ${error.response.status}: ${error.response.statusText}`;
        throw new Error(`Grok API error: ${error.response.status} - ${errorMessage}`);
      }
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  isAvailable(): boolean {
    return !!process.env.GROK_API_KEY;
  }
}