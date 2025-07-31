import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class AuthService {
  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'digest-370eb', // Explicitly set your project ID
      });
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