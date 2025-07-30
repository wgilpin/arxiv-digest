import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findOrCreateUser(firebaseUser: any): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { uid: firebaseUser.uid },
    });

    if (!user) {
      user = this.userRepository.create({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.name || firebaseUser.displayName,
        photoURL: firebaseUser.picture || firebaseUser.photoURL,
      });
      await this.userRepository.save(user);
    } else {
      // Update user info if it has changed
      let hasChanges = false;
      
      if (user.email !== firebaseUser.email) {
        user.email = firebaseUser.email;
        hasChanges = true;
      }
      
      const displayName = firebaseUser.name || firebaseUser.displayName;
      if (user.displayName !== displayName) {
        user.displayName = displayName;
        hasChanges = true;
      }
      
      const photoURL = firebaseUser.picture || firebaseUser.photoURL;
      if (user.photoURL !== photoURL) {
        user.photoURL = photoURL;
        hasChanges = true;
      }
      
      if (hasChanges) {
        await this.userRepository.save(user);
      }
    }

    return user;
  }

  async findByUid(uid: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { uid },
      relations: ['progress'],
    });
  }

  async deleteUser(uid: string): Promise<void> {
    await this.userRepository.delete({ uid });
  }
}