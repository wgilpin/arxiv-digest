import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore } from '@google-cloud/firestore';

@Injectable()
export class FirestoreService {
  private readonly logger = new Logger(FirestoreService.name);
  private firestore: Firestore;

  constructor(private configService: ConfigService) {
    const googleCloudProjectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT_ID');
    const firebaseProjectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const databaseId = this.configService.get<string>('FIRESTORE_DATABASE_ID', '(default)');
    
    // Use FIREBASE_PROJECT_ID if GOOGLE_CLOUD_PROJECT_ID is not set
    let projectId = googleCloudProjectId || firebaseProjectId;
    
    // Clean up any trailing slashes or whitespace
    if (projectId) {
      projectId = projectId.trim().replace(/\/$/, '');
    }
    if (!projectId) {
      this.logger.error('CRITICAL: No project ID found! Please set GOOGLE_CLOUD_PROJECT_ID or FIREBASE_PROJECT_ID in your .env file');
      throw new Error('Missing required project ID for Firestore');
    }
    
    const firestoreConfig: any = {
      projectId: projectId, // Always include project ID
    };
    
    if (databaseId !== '(default)') {
      firestoreConfig.databaseId = databaseId;
    }

    // Use service account credentials if available
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        firestoreConfig.credentials = serviceAccount;
        this.logger.log('Using service account credentials for Firestore');
      } catch (error) {
        this.logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', error);
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON');
      }
    }

    this.firestore = new Firestore(firestoreConfig);
    
    this.logger.log(`Firestore service initialized for project: ${projectId}${databaseId !== '(default)' ? ` with database: ${databaseId}` : ' with default database'}`);
  }

  getFirestore(): Firestore {
    return this.firestore;
  }

  getUserCoursesCollection(userId: string) {
    return this.firestore.collection('users').doc(userId).collection('courses');
  }

  async createCourse(userId: string, courseData: any) {
    const coursesCollection = this.getUserCoursesCollection(userId);
    
    this.logger.log(`Creating course for user: ${userId}`);
    this.logger.log(`Collection path: users/${userId}/courses`);
    this.logger.log(`Firestore settings:`, JSON.stringify(this.firestore.settings, null, 2));
    
    const docRef = await coursesCollection.add(courseData);
    
    this.logger.log(`Course created with ID: ${docRef.id}`);
    this.logger.log(`Full document path: users/${userId}/courses/${docRef.id}`);
    
    return docRef.id;
  }

  async getCourse(userId: string, courseId: string) {
    const courseDoc = await this.getUserCoursesCollection(userId).doc(courseId).get();
    if (!courseDoc.exists) {
      return null;
    }
    return { id: courseDoc.id, ...courseDoc.data() };
  }

  async getAllCourses(userId: string) {
    const snapshot = await this.getUserCoursesCollection(userId).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async updateCourse(userId: string, courseId: string, data: any) {
    await this.getUserCoursesCollection(userId).doc(courseId).update(data);
  }

  async deleteCourse(userId: string, courseId: string) {
    await this.getUserCoursesCollection(userId).doc(courseId).delete();
  }
}