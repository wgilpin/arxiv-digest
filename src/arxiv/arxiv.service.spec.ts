import { Test, TestingModule } from '@nestjs/testing';
import { ArxivService } from './arxiv.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('fs');
jest.mock('@google/generative-ai');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('ArxivService', () => {
  let service: ArxivService;
  const testArxivId = '2301.00001';
  const testCacheDir = './cache';
  const testPdfCacheDir = path.join(testCacheDir, 'pdfs');
  const testTextCacheDir = path.join(testCacheDir, 'text');

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock environment variable
    process.env.GEMINI_API_KEY = 'test-api-key';

    // Mock fs methods with default implementations
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.mkdirSync.mockImplementation();
    mockedFs.readFileSync.mockImplementation();
    mockedFs.writeFileSync.mockImplementation();
    mockedFs.statSync.mockReturnValue({
      mtime: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [ArxivService],
    }).compile();

    service = module.get<ArxivService>(ArxivService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Cache Directory Creation', () => {
    it('should create cache directories on initialization', () => {
      // Mock fs.existsSync to return false (directories don't exist)
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockImplementation();

      // Create a new service instance to trigger constructor
      new ArxivService();

      // Verify directories are created
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(testCacheDir, {
        recursive: true,
      });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(testPdfCacheDir, {
        recursive: true,
      });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(testTextCacheDir, {
        recursive: true,
      });
    });

    it('should not create directories if they already exist', () => {
      // Mock fs.existsSync to return true (directories exist)
      mockedFs.existsSync.mockReturnValue(true);

      // Create a new service instance
      new ArxivService();

      // Verify mkdirSync is not called
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle directory creation errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw error
      expect(() => new ArxivService()).not.toThrow();
    });
  });

  describe('PDF Caching', () => {
    it('should use cached PDF when valid cache exists', async () => {
      const mockPdfBuffer = Buffer.from('mock pdf content');
      const cachedText = 'cached cleaned text';
      const mockGeminiResponse = { response: { text: () => 'cleaned text' } };

      // Mock text cache doesn't exist, but PDF cache does
      mockedFs.existsSync.mockImplementation((filePath: any) => {
        if (filePath.includes('.txt')) {
          return false; // No text cache
        }
        return true; // PDF cache exists
      });

      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      } as any);

      // Mock reading cached PDF
      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('.pdf')) {
          return mockPdfBuffer;
        }
        return cachedText;
      });

      // Mock Gemini API
      const mockGenerateContent = jest
        .fn()
        .mockResolvedValue(mockGeminiResponse);
      const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });

      (service as any).genAI = {
        getGenerativeModel: mockGetGenerativeModel,
      };

      await service.getPaperText(testArxivId);

      // Verify PDF was read from cache, not downloaded
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        path.join(testPdfCacheDir, `${testArxivId}.pdf`),
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should download and cache PDF when no valid cache exists', async () => {
      const mockPdfBuffer = Buffer.from('mock pdf content');
      const mockGeminiResponse = { response: { text: () => 'cleaned text' } };

      // Mock cache validation to return false
      mockedFs.existsSync.mockReturnValue(false);

      // Mock axios download
      mockedAxios.get.mockResolvedValue({
        data: mockPdfBuffer.buffer,
      });

      // Mock writing to cache
      mockedFs.writeFileSync.mockImplementation();

      // Mock Gemini API
      const mockGenerateContent = jest
        .fn()
        .mockResolvedValue(mockGeminiResponse);
      const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });

      (service as any).genAI = {
        getGenerativeModel: mockGetGenerativeModel,
      };

      await service.getPaperText(testArxivId);

      // Verify PDF was downloaded
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `https://arxiv.org/pdf/${testArxivId}.pdf`,
        {
          responseType: 'arraybuffer',
          timeout: 30000,
        },
      );

      // Verify PDF was cached
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testPdfCacheDir, `${testArxivId}.pdf`),
        expect.any(Buffer),
      );
    });

    it('should handle PDF cache read errors gracefully', async () => {
      const mockPdfBuffer = Buffer.from('mock pdf content');
      const mockGeminiResponse = { response: { text: () => 'cleaned text' } };

      // Mock cache exists but reading fails
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      } as any);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      // Mock axios download as fallback
      mockedAxios.get.mockResolvedValue({
        data: mockPdfBuffer.buffer,
      });

      // Mock Gemini API
      const mockGenerateContent = jest
        .fn()
        .mockResolvedValue(mockGeminiResponse);
      const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });

      (service as any).genAI = {
        getGenerativeModel: mockGetGenerativeModel,
      };

      await service.getPaperText(testArxivId);

      // Should fall back to downloading
      expect(mockedAxios.get).toHaveBeenCalled();
    });
  });

  describe('Text Caching', () => {
    it('should use cached text when valid cache exists', async () => {
      const cachedText = 'cached cleaned text';

      // Mock text cache validation to return true
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      } as any);

      // Mock reading cached text - use different return values for different calls
      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('.txt')) {
          return cachedText;
        }
        return Buffer.from('mock pdf content');
      });

      const result = await service.getPaperText(testArxivId);

      expect(result).toBe(cachedText);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        path.join(testTextCacheDir, `${testArxivId}.txt`),
        'utf-8',
      );
    });

    it('should generate and cache text when no valid cache exists', async () => {
      const cleanedText = 'newly generated cleaned text';
      const mockPdfBuffer = Buffer.from('mock pdf content');
      const mockGeminiResponse = { response: { text: () => cleanedText } };

      // Mock no text cache exists
      mockedFs.existsSync.mockImplementation((filePath: any) => {
        if (filePath.includes('.txt')) {
          return false;
        }
        return false; // No PDF cache either
      });

      // Mock PDF download
      mockedAxios.get.mockResolvedValue({
        data: mockPdfBuffer.buffer,
      });

      // Mock writing to cache
      mockedFs.writeFileSync.mockImplementation();

      // Mock Gemini API
      const mockGenerateContent = jest
        .fn()
        .mockResolvedValue(mockGeminiResponse);
      const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });

      (service as any).genAI = {
        getGenerativeModel: mockGetGenerativeModel,
      };

      const result = await service.getPaperText(testArxivId);

      expect(result).toBe(cleanedText);

      // Verify text was cached
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testTextCacheDir, `${testArxivId}.txt`),
        cleanedText,
        'utf-8',
      );
    });

    it('should handle text cache read errors gracefully', async () => {
      const cleanedText = 'newly generated cleaned text';
      const mockPdfBuffer = Buffer.from('mock pdf content');
      const mockGeminiResponse = { response: { text: () => cleanedText } };

      // Mock text cache exists but reading fails
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      } as any);

      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('.txt')) {
          throw new Error('Read error');
        }
        return Buffer.from('mock pdf content');
      });

      // Mock PDF operations
      mockedAxios.get.mockResolvedValue({
        data: mockPdfBuffer.buffer,
      });

      // Mock Gemini API
      const mockGenerateContent = jest
        .fn()
        .mockResolvedValue(mockGeminiResponse);
      const mockGetGenerativeModel = jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      });

      (service as any).genAI = {
        getGenerativeModel: mockGetGenerativeModel,
      };

      const result = await service.getPaperText(testArxivId);

      // Should fall back to generating new text
      expect(result).toBe(cleanedText);
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe('Cache Validation', () => {
    it('should consider cache invalid when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const isValid = (service as any).isCachedPdfValid('/fake/path');

      expect(isValid).toBe(false);
    });

    it('should consider cache invalid when file is older than 7 days', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
      } as any);

      const isValid = (service as any).isCachedPdfValid('/fake/path');

      expect(isValid).toBe(false);
    });

    it('should consider cache valid when file is newer than 7 days', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({
        mtime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      } as any);

      const isValid = (service as any).isCachedPdfValid('/fake/path');

      expect(isValid).toBe(true);
    });

    it('should handle stat errors gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockImplementation(() => {
        throw new Error('Stat error');
      });

      const isValid = (service as any).isCachedPdfValid('/fake/path');

      expect(isValid).toBe(false);
    });
  });

  describe('ArXiv URL/ID Parsing', () => {
    it('should extract ID from various URL formats', () => {
      const testCases = [
        ['https://arxiv.org/abs/2507.11768', '2507.11768'],
        ['http://arxiv.org/abs/2507.11768', '2507.11768'],
        ['arxiv.org/abs/2507.11768', '2507.11768'],
        ['https://arxiv.org/pdf/2507.11768.pdf', '2507.11768'],
        ['https://arxiv.org/abs/math.GT/0309136', 'math.GT/0309136'],
        ['https://arxiv.org/abs/hep-th/9901001', 'hep-th/9901001'],
        ['https://arxiv.org/abs/1234.5678v1', '1234.5678v1'],
      ];

      testCases.forEach(([input, expected]) => {
        const result = (service as any).extractArxivId(input);
        expect(result).toBe(expected);
      });
    });

    it('should accept valid ArXiv IDs directly', () => {
      const testCases = [
        '2507.11768',
        '1234.5678',
        '1234.56789',
        '1234.5678v1',
        'math.GT/0309136',
        'hep-th/9901001',
        'cond-mat.mes-hall/0309136v2',
      ];

      testCases.forEach((arxivId) => {
        const result = (service as any).extractArxivId(arxivId);
        expect(result).toBe(arxivId);
      });
    });

    it('should throw error for invalid inputs', () => {
      const invalidInputs = [
        '',
        '   ',
        'not-an-arxiv-id',
        'https://example.com/paper',
        '12345',
        'abc.def',
        'https://arxiv.org/invalid/2507.11768',
      ];

      invalidInputs.forEach((input) => {
        expect(() => (service as any).extractArxivId(input)).toThrow();
      });
    });

    it('should throw error for null or undefined input', () => {
      expect(() => (service as any).extractArxivId(null)).toThrow(
        'Invalid input: must be a non-empty string',
      );
      expect(() => (service as any).extractArxivId(undefined)).toThrow(
        'Invalid input: must be a non-empty string',
      );
    });

    it('should handle URLs with query parameters and fragments', () => {
      const testCases = [
        ['https://arxiv.org/abs/2507.11768?context=cs', '2507.11768'],
        ['https://arxiv.org/abs/2507.11768#section1', '2507.11768'],
        ['https://arxiv.org/pdf/2507.11768.pdf?download=true', '2507.11768'],
      ];

      testCases.forEach(([input, expected]) => {
        const result = (service as any).extractArxivId(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Integration with URL inputs', () => {
    it('should work with URLs in fetchPaperTitle', async () => {
      const mockResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Test Paper Title</title>
          </entry>
        </feed>`,
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await service.fetchPaperTitle(
        'https://arxiv.org/abs/2507.11768',
      );

      expect(result).toBe('Test Paper Title');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://export.arxiv.org/api/query',
        {
          params: { id_list: '2507.11768' },
          responseType: 'text',
          transformResponse: [expect.any(Function)],
        },
      );
    });

    it('should work with URLs in getPaperText', async () => {
      const cachedText = 'cached cleaned text from URL test';

      // Mock text cache exists
      mockedFs.existsSync.mockImplementation((filePath: any) => {
        if (filePath.includes('2507.11768.txt')) {
          return true;
        }
        return false;
      });

      mockedFs.readFileSync.mockImplementation((filePath: any) => {
        if (filePath.includes('2507.11768.txt')) {
          return cachedText;
        }
        return Buffer.from('mock content');
      });

      const result = await service.getPaperText(
        'https://arxiv.org/abs/2507.11768',
      );

      expect(result).toBe(cachedText);
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        path.join(testTextCacheDir, '2507.11768.txt'),
        'utf-8',
      );
    });
  });
});
