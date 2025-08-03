export interface LLMFileUpload {
  data: Buffer;
  mimeType: string;
}

export interface LLMRequest {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  fileUpload?: LLMFileUpload;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface LLMResponse {
  content: string;
  usage?: {
    // Standard format
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    // Gemini format
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    // Grok format  
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
}

export interface LLMProvider {
  name: string;
  generateContent(request: LLMRequest): Promise<LLMResponse>;
  isAvailable(): boolean;
}

export enum LLMProviderType {
  GEMINI = 'gemini',
  GROK = 'grok',
}

export enum ModelUsage {
  PDF_EXTRACTION = 'pdf_extraction',
  CONCEPT_EXTRACTION = 'concept_extraction',
  LESSON_TITLES = 'lesson_titles',
  LESSON_GENERATION = 'lesson_generation',
}

export interface LLMConfig {
  defaultProvider: LLMProviderType;
  gemini?: {
    apiKey: string;
    pdfExtractionModel?: string;
    largeModel?: string;
    fastModel?: string;
  };
  grok?: {
    apiKey: string;
    largeModel?: string;
    fastModel?: string;
  };
}