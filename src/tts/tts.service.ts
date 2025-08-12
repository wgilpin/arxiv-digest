import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { google } from '@google-cloud/text-to-speech/build/protos/protos';
import { FirebaseStorageService } from '../storage/storage.service';
import * as admin from 'firebase-admin';

@Injectable()
export class TTSService {
  private client: TextToSpeechClient;
  private logger = new Logger(TTSService.name);
  private costPerMillion: number | null = null;
  private voiceName: string;
  private voiceType: string;

  constructor(
    private configService: ConfigService,
    private storageService: FirebaseStorageService,
  ) {
    this.voiceName = this.configService.get('TTS_VOICE') || 'en-US-Neural2-D';
    this.voiceType = this.configService.get('TTS_VOICE_TYPE') || 'neural2';
    // Note: Google Cloud TTS requires either:
    // 1. A service account key file with GOOGLE_APPLICATION_CREDENTIALS env var
    // 2. OR proper authentication through Google Cloud SDK
    // The Gemini API key cannot be used for Text-to-Speech API
    
    const credentialsPath = this.configService.get('GOOGLE_APPLICATION_CREDENTIALS');
    
    if (!credentialsPath) {
      this.logger.warn(
        'GOOGLE_APPLICATION_CREDENTIALS not set. TTS features will be disabled. ' +
        'To enable TTS: 1) Create a Google Cloud service account, ' +
        '2) Enable Text-to-Speech API, 3) Download credentials JSON, ' +
        '4) Set GOOGLE_APPLICATION_CREDENTIALS env var to the JSON file path'
      );
      this.client = null as any;
    } else {
      try {
        this.client = new TextToSpeechClient({
          keyFilename: credentialsPath,
        });
        this.logger.log('Google TTS client initialized with service account credentials');
      } catch (error) {
        this.logger.error('Failed to initialize Google TTS client:', error);
        this.client = null as any;
      }
    }
  }

  private async loadTTSCosts(): Promise<void> {
    if (this.costPerMillion !== null) {
      return; // Already loaded
    }

    try {
      const firestore = admin.firestore();
      const costDoc = await firestore
        .doc(`model-costs/tts-costs/CLASS/${this.voiceType}`)
        .get();

      if (costDoc.exists) {
        const data = costDoc.data();
        this.costPerMillion = data?.costPerMillion || 16; // Default to Neural2 cost
        this.logger.log(`Loaded TTS cost for ${this.voiceType}: $${this.costPerMillion} per million characters`);
      } else {
        this.logger.warn(`No cost data found for voice type: ${this.voiceType}, using default cost`);
        this.costPerMillion = 16; // Default Neural2 cost
      }
    } catch (error) {
      this.logger.error('Error loading TTS costs from Firestore:', error);
      this.costPerMillion = 16; // Fallback to default cost
    }
  }

  async synthesizeLessonAudio(
    courseId: string,
    moduleIndex: number,
    lessonIndex: number,
    text: string,
    options?: {
      voiceName?: string;
      languageCode?: string;
      speakingRate?: number;
      pitch?: number;
      volumeGainDb?: number;
    },
  ): Promise<{ audioUrl: string; cached: boolean; cost: number }> {
    if (!this.client) {
      throw new Error(
        'TTS service is not configured. Please set up Google Cloud credentials. ' +
        'See server logs for setup instructions.'
      );
    }

    // Load TTS costs if not already loaded
    await this.loadTTSCosts();

    const cacheKey = `audio/lessons/${courseId}/${moduleIndex}-${lessonIndex}.mp3`;
    
    const exists = await this.storageService.fileExists(cacheKey);
    if (exists) {
      const audioUrl = await this.storageService.getPublicUrl(cacheKey);
      this.logger.log(`Returning cached audio for lesson ${courseId}/${moduleIndex}/${lessonIndex}`);
      return { audioUrl, cached: true, cost: 0 };
    }

    const processedText = this.preprocessTextForTTS(text);
    
    // Use plain text instead of SSML for now to avoid validation issues
    this.logger.debug('Processed text for TTS:', processedText.substring(0, 200) + (processedText.length > 200 ? '...' : ''));

    const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
      input: { text: processedText },
      voice: {
        languageCode: options?.languageCode || 'en-US',
        name: options?.voiceName || this.voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3' as const,
        speakingRate: options?.speakingRate || 1.0,
        pitch: options?.pitch || 0,
        volumeGainDb: options?.volumeGainDb || 0,
      },
    };

    try {
      const [response] = await this.client.synthesizeSpeech(request);
      
      const characterCount = processedText.length;
      const estimatedCost = (characterCount / 1_000_000) * (this.costPerMillion || 16);
      
      this.logger.log(`Generated audio for ${characterCount} characters using ${this.voiceName} (${this.voiceType}). Estimated cost: $${estimatedCost.toFixed(6)}`);
      
      const audioBuffer = Buffer.from(response.audioContent as string, 'base64');
      
      // Retry upload with exponential backoff on network errors
      let audioUrl: string | undefined;
      let uploadAttempts = 0;
      const maxAttempts = 3;
      
      while (uploadAttempts < maxAttempts) {
        try {
          audioUrl = await this.storageService.uploadBuffer(
            cacheKey,
            audioBuffer,
            {
              courseId,
              moduleIndex: moduleIndex.toString(),
              lessonIndex: lessonIndex.toString(),
              generatedAt: new Date().toISOString(),
            }
          );
          break; // Success, exit retry loop
        } catch (uploadError) {
          uploadAttempts++;
          this.logger.warn(`Upload attempt ${uploadAttempts} failed:`, uploadError.message);
          
          if (uploadAttempts >= maxAttempts) {
            this.logger.error(`Failed to upload audio after ${maxAttempts} attempts`);
            throw uploadError;
          }
          
          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, uploadAttempts) * 1000;
          this.logger.log(`Retrying upload in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      if (!audioUrl) {
        throw new Error('Failed to upload audio file');
      }
      
      return { audioUrl, cached: false, cost: estimatedCost };
    } catch (error) {
      this.logger.error('Failed to synthesize speech:', error);
      throw error;
    }
  }

  private preprocessTextForTTS(text: string): string {
    let processed = text;
    
    // Remove markdown formatting but preserve text
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '$1');
    processed = processed.replace(/\*([^*]+)\*/g, '$1');
    processed = processed.replace(/__([^_]+)__/g, '$1');
    processed = processed.replace(/_([^_]+)_/g, '$1');
    
    // Handle headings: remove markdown and ensure they end with a period if they don't have punctuation
    processed = processed.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, title) => {
      // If the heading doesn't end with punctuation, add a period
      const cleanTitle = title.trim();
      if (!/[.!?]$/.test(cleanTitle)) {
        return cleanTitle + '.';
      }
      return cleanTitle;
    });
    
    // Remove code blocks entirely
    processed = processed.replace(/```[\s\S]*?```/g, '');
    
    // Remove inline code backticks but keep the content
    processed = processed.replace(/`([^`]+)`/g, '$1');
    
    // Convert links to just their text
    processed = processed.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // Remove images
    processed = processed.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    
    // Handle mathematical expressions
    processed = processed.replace(/\$\$([^$]+)\$\$/g, (_, math) => {
      return this.simplifyMathForSpeech(math);
    });
    processed = processed.replace(/\$([^$]+)\$/g, (_, math) => {
      return this.simplifyMathForSpeech(math);
    });
    
    // Clean up whitespace and ensure proper paragraph breaks
    processed = processed.replace(/\n\s*\n/g, '\n\n'); // Preserve paragraph breaks
    processed = processed.replace(/\s+/g, ' '); // Normalize other whitespace
    processed = processed.replace(/\n\n/g, '. '); // Convert paragraph breaks to sentence breaks
    processed = processed.trim();
    
    const maxLength = 5000;
    if (processed.length > maxLength) {
      processed = processed.substring(0, maxLength) + '...';
      this.logger.warn(`Text truncated to ${maxLength} characters for TTS`);
    }
    
    return processed;
  }

  private simplifyMathForSpeech(math: string): string {
    let simplified = math;
    
    simplified = simplified.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2');
    simplified = simplified.replace(/\^/g, ' to the power of ');
    simplified = simplified.replace(/_/g, ' sub ');
    simplified = simplified.replace(/\\sqrt/g, 'square root of ');
    simplified = simplified.replace(/\\sum/g, 'sum ');
    simplified = simplified.replace(/\\int/g, 'integral ');
    simplified = simplified.replace(/\\partial/g, 'partial ');
    simplified = simplified.replace(/\\nabla/g, 'nabla ');
    simplified = simplified.replace(/\\theta/g, 'theta ');
    simplified = simplified.replace(/\\alpha/g, 'alpha ');
    simplified = simplified.replace(/\\beta/g, 'beta ');
    simplified = simplified.replace(/\\gamma/g, 'gamma ');
    simplified = simplified.replace(/\\delta/g, 'delta ');
    simplified = simplified.replace(/\\epsilon/g, 'epsilon ');
    simplified = simplified.replace(/\\sigma/g, 'sigma ');
    simplified = simplified.replace(/\\mu/g, 'mu ');
    simplified = simplified.replace(/\\lambda/g, 'lambda ');
    simplified = simplified.replace(/\\pi/g, 'pi ');
    simplified = simplified.replace(/\\infty/g, 'infinity ');
    simplified = simplified.replace(/\\cdot/g, ' times ');
    simplified = simplified.replace(/\\times/g, ' times ');
    simplified = simplified.replace(/\\leq/g, ' less than or equal to ');
    simplified = simplified.replace(/\\geq/g, ' greater than or equal to ');
    simplified = simplified.replace(/\\neq/g, ' not equal to ');
    simplified = simplified.replace(/\\approx/g, ' approximately equal to ');
    simplified = simplified.replace(/\\in/g, ' in ');
    simplified = simplified.replace(/\\mathbb\{([^}]+)\}/g, '$1');
    simplified = simplified.replace(/\\mathcal\{([^}]+)\}/g, '$1');
    simplified = simplified.replace(/\\[a-zA-Z]+/g, '');
    
    return simplified;
  }

  formatTechnicalContent(text: string): string {
    // First, escape any XML characters that might be in the text
    let cleanText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    let ssml = `<speak>${cleanText}`;
    
    ssml = ssml.replace(/(\d+)\^(\d+)/g, '<say-as interpret-as="verbatim">$1</say-as> to the power of <say-as interpret-as="verbatim">$2</say-as>');
    
    const pronunciations = {
      'BERT': '<phoneme alphabet="ipa" ph="bɜrt">BERT</phoneme>',
      'GPT': '<phoneme alphabet="ipa" ph="dʒiː piː tiː">GPT</phoneme>',
      'ReLU': '<phoneme alphabet="ipa" ph="ˈrɛluː">ReLU</phoneme>',
      'LSTM': '<sub alias="long short term memory">LSTM</sub>',
      'CNN': '<sub alias="convolutional neural network">CNN</sub>',
      'GAN': '<sub alias="generative adversarial network">GAN</sub>',
      'VAE': '<sub alias="variational autoencoder">VAE</sub>',
      'MLP': '<sub alias="multi layer perceptron">MLP</sub>',
      'RNN': '<sub alias="recurrent neural network">RNN</sub>',
      'GRU': '<sub alias="gated recurrent unit">GRU</sub>',
      'NLP': '<sub alias="natural language processing">NLP</sub>',
      'API': '<sub alias="A P I">API</sub>',
      'GPU': '<sub alias="graphics processing unit">GPU</sub>',
      'CPU': '<sub alias="central processing unit">CPU</sub>',
      'RAM': '<sub alias="random access memory">RAM</sub>',
      'JSON': '<sub alias="jason">JSON</sub>',
      'XML': '<sub alias="X M L">XML</sub>',
      'HTML': '<sub alias="H T M L">HTML</sub>',
      'CSS': '<sub alias="C S S">CSS</sub>',
      'SQL': '<sub alias="sequel">SQL</sub>',
      'NoSQL': '<sub alias="no sequel">NoSQL</sub>',
      'REST': '<sub alias="rest">REST</sub>',
      'GraphQL': '<sub alias="graph Q L">GraphQL</sub>',
      'OAuth': '<sub alias="oh auth">OAuth</sub>',
      'JWT': '<sub alias="J W T">JWT</sub>',
      'CORS': '<sub alias="cors">CORS</sub>',
      'XSS': '<sub alias="cross site scripting">XSS</sub>',
      'CSRF': '<sub alias="cross site request forgery">CSRF</sub>',
      'DDoS': '<sub alias="distributed denial of service">DDoS</sub>',
      'IoT': '<sub alias="internet of things">IoT</sub>',
      'ML': '<sub alias="machine learning">ML</sub>',
      'AI': '<sub alias="artificial intelligence">AI</sub>',
      'AGI': '<sub alias="artificial general intelligence">AGI</sub>',
      'CV': '<sub alias="computer vision">CV</sub>',
      'NLU': '<sub alias="natural language understanding">NLU</sub>',
      'NLG': '<sub alias="natural language generation">NLG</sub>',
      'arxiv': '<sub alias="archive">arxiv</sub>',
      'arXiv': '<sub alias="archive">arXiv</sub>',
      'LaTeX': '<sub alias="lay tech">LaTeX</sub>',
      'TeX': '<sub alias="tech">TeX</sub>',
    };
    
    for (const [term, pronunciation] of Object.entries(pronunciations)) {
      const regex = new RegExp(`\\b${term}\\b`, 'g');
      ssml = ssml.replace(regex, pronunciation);
    }
    
    // Add breaks for better speech rhythm
    ssml = ssml.replace(/([.!?])\s+/g, '$1<break time="500ms"/> '); // Longer pause after sentences
    ssml = ssml.replace(/,\s+/g, ',<break time="200ms"/> '); // Short pause after commas
    ssml = ssml.replace(/:\s+/g, ':<break time="300ms"/> '); // Medium pause after colons
    ssml = ssml.replace(/;\s+/g, ';<break time="250ms"/> '); // Medium pause after semicolons
    
    ssml += '</speak>';
    return ssml;
  }

  async listVoices(languageCode = 'en-US'): Promise<google.cloud.texttospeech.v1.IVoice[]> {
    if (!this.client) {
      throw new Error('TTS service is not configured');
    }
    
    const [response] = await this.client.listVoices({ languageCode });
    return response.voices || [];
  }

  async estimateCost(text: string): Promise<number> {
    // Load costs if not already loaded
    await this.loadTTSCosts();
    
    return (text.length / 1_000_000) * (this.costPerMillion || 16);
  }

  async checkAudioExists(courseId: string, moduleIndex: number, lessonIndex: number): Promise<{ exists: boolean; url?: string }> {
    const cacheKey = `audio/lessons/${courseId}/${moduleIndex}-${lessonIndex}.mp3`;
    const exists = await this.storageService.fileExists(cacheKey);
    
    if (exists) {
      const url = await this.storageService.getPublicUrl(cacheKey);
      return { exists: true, url };
    }
    
    return { exists: false };
  }

  async deleteAudioCache(courseId: string, moduleIndex?: number, lessonIndex?: number): Promise<void> {
    if (moduleIndex !== undefined && lessonIndex !== undefined) {
      const cacheKey = `audio/lessons/${courseId}/${moduleIndex}-${lessonIndex}.mp3`;
      await this.storageService.deleteFile(cacheKey);
      this.logger.log(`Deleted audio cache for lesson ${courseId}/${moduleIndex}/${lessonIndex}`);
    } else {
      await this.storageService.deleteFolderContents(`audio/lessons/${courseId}`);
      this.logger.log(`Deleted all audio cache for course ${courseId}`);
    }
  }
}