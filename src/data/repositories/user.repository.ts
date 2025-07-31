import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../../firestore/firestore.service';
import { User } from '../../firestore/interfaces/firestore.interfaces';

@Injectable()
export class UserRepository {
  constructor(private readonly firestoreService: FirestoreService) {}

  async findByUid(uid: string): Promise<User | null> {
    const userDoc = await this.firestoreService.getFirestore()
      .collection('users')
      .doc(uid)
      .get();
    
    if (!userDoc.exists) {
      return null;
    }
    
    return { uid: userDoc.id, ...userDoc.data() } as User;
  }

  async createUser(userData: User): Promise<void> {
    const userWithTimestamp = {
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.firestoreService.getFirestore()
      .collection('users')
      .doc(userData.uid)
      .set(userWithTimestamp);
  }

  async updateUser(uid: string, updates: Partial<User>): Promise<void> {
    const updatesWithTimestamp = {
      ...updates,
      updatedAt: new Date(),
    };
    
    await this.firestoreService.getFirestore()
      .collection('users')
      .doc(uid)
      .update(updatesWithTimestamp);
  }

  async deleteUser(uid: string): Promise<void> {
    // Delete user document and all subcollections (courses)
    const userRef = this.firestoreService.getFirestore().collection('users').doc(uid);
    
    // Delete all courses first
    const coursesSnapshot = await userRef.collection('courses').get();
    const batch = this.firestoreService.getFirestore().batch();
    
    coursesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    // Delete user document
    batch.delete(userRef);
    
    await batch.commit();
  }
}