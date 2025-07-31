import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseStorageService {
  private readonly logger = new Logger(FirebaseStorageService.name);
  private readonly storage: admin.storage.Storage;
  private readonly bucketName: string;

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get<string>('FIREBASE_STORAGE_BUCKET') || '';
    
    if (!this.bucketName) {
      throw new Error('FIREBASE_STORAGE_BUCKET environment variable is required');
    }

    this.storage = admin.storage();
    this.logger.log(`Firebase Storage service initialized for bucket: ${this.bucketName}`);
  }

  /**
   * Upload a buffer to Firebase Storage
   */
  async uploadBuffer(
    filePath: string, 
    buffer: Buffer, 
    metadata?: { [key: string]: string }
  ): Promise<string> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      
      const stream = file.createWriteStream({
        metadata: {
          contentType: this.getContentType(filePath),
          metadata: metadata || {}
        }
      });

      return new Promise((resolve, reject) => {
        stream.on('error', (error) => {
          this.logger.error(`Error uploading ${filePath}:`, error);
          reject(error);
        });

        stream.on('finish', async () => {
          try {
            // Files are kept private by default - only accessible via Firebase Admin SDK
            // This is more secure for PDF and text content
            
            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
            this.logger.log(`Successfully uploaded: ${filePath}`);
            resolve(publicUrl);
          } catch (error) {
            reject(error);
          }
        });

        stream.end(buffer);
      });
    } catch (error) {
      this.logger.error(`Failed to upload ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Upload text content to Firebase Storage
   */
  async uploadText(filePath: string, text: string, metadata?: { [key: string]: string }): Promise<string> {
    const buffer = Buffer.from(text, 'utf-8');
    return this.uploadBuffer(filePath, buffer, metadata);
  }

  /**
   * Download a file from Firebase Storage as buffer
   */
  async downloadBuffer(filePath: string): Promise<Buffer> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      const [buffer] = await file.download();
      
      this.logger.log(`Successfully downloaded: ${filePath}`);
      return buffer;
    } catch (error) {
      this.logger.error(`Failed to download ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Download a text file from Firebase Storage
   */
  async downloadText(filePath: string): Promise<string> {
    const buffer = await this.downloadBuffer(filePath);
    return buffer.toString('utf-8');
  }

  /**
   * Check if a file exists in Firebase Storage
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      this.logger.error(`Error checking if ${filePath} exists:`, error);
      return false;
    }
  }

  /**
   * Get file metadata from Firebase Storage
   */
  async getFileMetadata(filePath: string): Promise<any> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      const [metadata] = await file.getMetadata();
      return metadata;
    } catch (error) {
      this.logger.error(`Error getting metadata for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if a cached file is still valid (within maxAge)
   */
  async isCacheValid(filePath: string, maxAgeHours: number = 24 * 7): Promise<boolean> {
    try {
      if (!(await this.fileExists(filePath))) {
        return false;
      }

      const metadata = await this.getFileMetadata(filePath);
      const createdTime = new Date(metadata.timeCreated).getTime();
      const ageInHours = (Date.now() - createdTime) / (1000 * 60 * 60);
      
      return ageInHours < maxAgeHours;
    } catch (error) {
      this.logger.error(`Error checking cache validity for ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Delete a file from Firebase Storage
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      await file.delete();
      this.logger.log(`Successfully deleted: ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to delete ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Generate storage paths for ArXiv files
   */
  generateArxivPaths(arxivId: string) {
    return {
      pdf: `arxiv/pdfs/${arxivId}.pdf`,
      html: `arxiv/html/${arxivId}.html`,
      text: `arxiv/text/${arxivId}.txt`
    };
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'pdf':
        return 'application/pdf';
      case 'html':
        return 'text/html';
      case 'txt':
        return 'text/plain';
      case 'json':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  }
}