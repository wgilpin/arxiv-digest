/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { UserRepository } from '../data/repositories/user.repository';
import { User } from '../firestore/interfaces/firestore.interfaces';

@Injectable()
export class UserService {
  constructor(
    private userRepository: UserRepository,
  ) {}

  async findOrCreateUser(firebaseUser: any): Promise<User> {
    const user = await this.userRepository.findByUid(firebaseUser.uid);

    if (!user) {
      const newUser: User = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.name || firebaseUser.displayName || null,
        photoURL: firebaseUser.picture || firebaseUser.photoURL || null,
        createdAt: new Date(),
      };
      await this.userRepository.createUser(newUser);
      return newUser;
    } else {
      // Update user info if it has changed
      const updates: Partial<User> = {};
      
      if (user.email !== firebaseUser.email) {
        updates.email = firebaseUser.email;
      }
      
      const displayName = firebaseUser.name || firebaseUser.displayName || null;
      if (user.displayName !== displayName) {
        updates.displayName = displayName;
      }
      
      const photoURL = firebaseUser.picture || firebaseUser.photoURL || null;
      if (user.photoURL !== photoURL) {
        updates.photoURL = photoURL;
      }
      
      if (Object.keys(updates).length > 0) {
        await this.userRepository.updateUser(user.uid, updates);
        return { ...user, ...updates };
      }
    }

    return user;
  }

  async findByUid(uid: string): Promise<User | null> {
    return this.userRepository.findByUid(uid);
  }

  async deleteUser(uid: string): Promise<void> {
    await this.userRepository.deleteUser(uid);
  }
}