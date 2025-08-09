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
    
    // Configure for better network handling
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    // Log network configuration for debugging
    debugLog('Gemini provider initialized', {
      hasApiKey: !!apiKey,
      nodeEnv: process.env.NODE_ENV,
      httpProxy: process.env.HTTP_PROXY || process.env.http_proxy,
      httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy
    });
  }

  async generateContent(request: LLMRequest): Promise<LLMResponse> {
    debugLog('Gemini provider generating content with request:', {
      promptLength: request.prompt.length,
      model: request.model || this.defaultModel,
      hasSystemPrompt: !!request.systemPrompt,
      hasFileUpload: !!request.fileUpload
    });

    try {
      const modelName = request.model || this.defaultModel;
      debugLog(`Using Gemini model: ${modelName}`);
      
      const model = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: request.temperature || 0.7,
          maxOutputTokens: request.maxTokens || 8192,
        },
      });

      const prompt = request.systemPrompt 
        ? `${request.systemPrompt}\n\n${request.prompt}`
        : request.prompt;

      debugLog('Making Gemini API request...');
      
      // Retry logic with exponential backoff for network issues
      let result;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          debugLog(`Gemini API attempt ${attempt}/${maxRetries}`);
          
          if (request.fileUpload) {
            debugLog('Sending file upload request to Gemini');
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
            debugLog('Sending text-only request to Gemini');
            result = await model.generateContent(prompt);
          }
          
          // If we get here, the request succeeded
          debugLog(`Gemini API request succeeded on attempt ${attempt}`);
          break;
          
        } catch (error: any) {
          debugLog(`Gemini API attempt ${attempt} failed:`, error.message);
          
          // If this is the last attempt, or if it's not a network error, don't retry
          if (attempt === maxRetries || !error.message?.includes('fetch failed')) {
            throw error;
          }
          
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          debugLog(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
      
      if (!result) {
        throw new Error('Gemini API request failed - no result received');
      }
      
      debugLog('Gemini API request completed, processing response...');
      const response = result.response;
      const content = response.text();
      
      debugLog('Gemini response received successfully, content length:', content.length);

      // Extract token usage from Gemini response
      const usageMetadata = response.usageMetadata;
      const usage = usageMetadata ? {
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
        // Keep original format for compatibility
        promptTokenCount: usageMetadata.promptTokenCount || 0,
        candidatesTokenCount: usageMetadata.candidatesTokenCount || 0,
        totalTokenCount: usageMetadata.totalTokenCount || 0,
      } : undefined;

      debugLog('Gemini token usage:', usage);

      return {
        content,
        model: modelName,
        usage,
      };
    } catch (error: any) {
      console.error('Gemini provider error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      });
      debugLog('Gemini provider error:', error);
      
      // Provide more specific error information
      let errorMessage = `Gemini API error: ${error.message}`;
      if (error.message?.includes('fetch failed')) {
        errorMessage += ' (Network connectivity issue - check internet connection and firewall settings)';
      }
      
      throw new Error(errorMessage);
    }
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}