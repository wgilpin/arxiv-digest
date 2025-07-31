import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore } from '@google-cloud/firestore';

@Injectable()
export class FirestoreService {
  private readonly logger = new Logger(FirestoreService.name);
  private firestore: Firestore;

  constructor(private configService: ConfigService) {
    const projectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT_ID');
    const databaseId = this.configService.get<string>('FIRESTORE_DATABASE_ID', '(default)');
    
    const firestoreConfig: any = {};
    if (projectId) {
      firestoreConfig.projectId = projectId;
    }
    if (databaseId !== '(default)') {
      firestoreConfig.databaseId = databaseId;
    }

    this.firestore = new Firestore(firestoreConfig);
    
    this.logger.log(`Firestore service initialized${projectId ? ` for project: ${projectId}` : ''}${databaseId !== '(default)' ? ` with database: ${databaseId}` : ''}`);
  }

  getFirestore(): Firestore {
    return this.firestore;
  }

  getUserCoursesCollection(userId: string) {
    return this.firestore.collection('users').doc(userId).collection('courses');
  }

  async createCourse(userId: string, courseData: any) {
    const coursesCollection = this.getUserCoursesCollection(userId);
    const docRef = await coursesCollection.add(courseData);
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