import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { File } from '@google-cloud/storage';

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

        stream.on('finish', () => void (async () => {
          try {
            // For image and audio files, make them publicly accessible
            const isPublicFile = /\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg)$/i.test(filePath);
            
            if (isPublicFile) {
              try {
                // Make the file publicly accessible
                await file.makePublic();
                const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
                this.logger.log(`Successfully uploaded public file: ${filePath}`);
                resolve(publicUrl);
              } catch (publicError) {
                // If making public fails, just return the storage URL
                // The file might already be public or there might be permission issues
                this.logger.warn(`Could not make file public, using storage URL: ${filePath}`, publicError);
                const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
                resolve(publicUrl);
              }
            } else {
              // For other files, try to make them public anyway
              try {
                await file.makePublic();
                const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
                this.logger.log(`Successfully uploaded file: ${filePath}`);
                resolve(publicUrl);
              } catch (publicError) {
                this.logger.warn(`Could not make file public, using storage URL: ${filePath}`, publicError);
                const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
                resolve(publicUrl);
              }
            }
          } catch (error) {
            this.logger.error(`Error finalizing upload for ${filePath}:`, error);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })());

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
   * Get a public URL for an existing file
   */
  async getPublicUrl(filePath: string): Promise<string> {
    try {
      const file = this.storage.bucket(this.bucketName).file(filePath);
      const isPublicFile = /\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg)$/i.test(filePath);
      
      if (isPublicFile) {
        try {
          // Try to ensure the file is public
          await file.makePublic();
        } catch (error) {
          // If making public fails, continue anyway
          this.logger.warn(`Could not make file public: ${filePath}`, error);
        }
        return `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      } else {
        // For other files, try to make them public and return the storage URL
        try {
          await file.makePublic();
        } catch (error) {
          this.logger.warn(`Could not make file public: ${filePath}`, error);
        }
        return `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
      }
    } catch (error) {
      this.logger.error(`Error getting public URL for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get file metadata from Firebase Storage
   */
  async getFileMetadata(filePath: string): Promise<{ timeCreated?: string; [key: string]: any }> {
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
      if (!metadata.timeCreated) {
        this.logger.warn(`No timeCreated found for ${filePath}, assuming file is invalid`);
        return false;
      }
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
   * Delete all files in a folder
   */
  async deleteFolderContents(folderPath: string): Promise<void> {
    try {
      const [files] = await this.storage.bucket(this.bucketName).getFiles({
        prefix: folderPath.endsWith('/') ? folderPath : `${folderPath}/`,
      });
      
      if (files.length === 0) {
        this.logger.log(`No files found in folder: ${folderPath}`);
        return;
      }
      
      await Promise.all(files.map(file => file.delete()));
      this.logger.log(`Successfully deleted ${files.length} files from folder: ${folderPath}`);
    } catch (error) {
      this.logger.error(`Failed to delete folder contents ${folderPath}:`, error);
      throw error;
    }
  }

  /**
   * Generate storage paths for ArXiv files (only cache extracted text - PDFs/HTML always available on ArXiv)
   */
  generateArxivPaths(arxivId: string) {
    return {
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
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'ogg':
        return 'audio/ogg';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }
}