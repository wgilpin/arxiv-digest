import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMRequest, LLMResponse } from '../interfaces/llm.interface';
import { debugLog } from '../../common/debug-logger';

@Injectable()
export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private defaultModel = 'gemini-2.5-flash';

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    debugLog('Gemini provider generating content with request:', {
      promptLength: request.prompt.length,
      model: request.model || this.defaultModel,
      hasSystemPrompt: !!request.systemPrompt
    });

    try {
      const model = this.genAI.getGenerativeModel({
        model: request.model || this.defaultModel,
        generationConfig: {
          temperature: request.temperature || 0.7,
          maxOutputTokens: request.maxTokens || 8192,
        },
      });

      const prompt = request.systemPrompt 
        ? `${request.systemPrompt}\n\n${request.prompt}`
        : request.prompt;

      let result;
      if (request.fileUpload) {
        // Handle file upload with Gemini
        result = await model.generateContent([
          prompt,
          {
            inlineData: {
              data: request.fileUpload.data.toString('base64'),
              mimeType: request.fileUpload.mimeType,
            },
          },
        ]);
      } else {
        result = await model.generateContent(prompt);
      }
      const response = await result.response;
      const content = response.text();

      return {
        content,
        model: request.model || this.defaultModel,
        usage: {
          // Gemini API doesn't provide token usage in the same way
          // You could estimate or leave undefined
          totalTokens: undefined,
        },
      };
    } catch (error) {
      debugLog('Gemini provider error:', error);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}