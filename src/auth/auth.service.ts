import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { debugLog } from 'src/common/debug-logger';

@Injectable()
export class AuthService {
  constructor() {
    if (!admin.apps.length) {
      try {
        debugLog('Initializing Firebase Admin...');
        debugLog('FIREBASE_SERVICE_ACCOUNT present:', !!process.env.FIREBASE_SERVICE_ACCOUNT);
        
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
          // Use service account key from environment variable (production)
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          debugLog('Service account project_id:', serviceAccount.project_id);
          
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id, // Use project_id from service account
          });
          debugLog('Firebase Admin initialized with service account');
        } else {
          // Fallback to application default credentials (development)
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: 'digest-370eb',
          });
          debugLog('Firebase Admin initialized with application default');
        }
      } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error);
        throw new Error('Firebase Admin initialization failed');
      }
    }
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      console.error('Error details:', {
        code: error.code,
        message: error.message
      });
      throw new Error('Invalid token');
    }
  }

  async getUser(uid: string): Promise<admin.auth.UserRecord> {
    try {
      return await admin.auth().getUser(uid);
    } catch (error) {
      throw new Error('User not found');
    }
  }

  async createCustomToken(uid: string): Promise<string> {
    try {
      return await admin.auth().createCustomToken(uid);
    } catch (error) {
      throw new Error('Failed to create custom token');
    }
  }

  async deleteUser(uid: string): Promise<void> {
    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      throw new Error('Failed to delete user');
    }
  }
}