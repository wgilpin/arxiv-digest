import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { CourseRepository } from './repositories/course.repository';
import { UserRepository } from './repositories/user.repository';

@Module({
  imports: [FirestoreModule],
  providers: [CourseRepository, UserRepository],
  exports: [CourseRepository, UserRepository],
})
export class DataModule {}