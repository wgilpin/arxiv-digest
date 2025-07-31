import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { CourseRepository } from './repositories/course.repository';
import { UserRepository } from './repositories/user.repository';
import { ModelCostRepository } from './repositories/model-cost.repository';

@Module({
  imports: [FirestoreModule],
  providers: [CourseRepository, UserRepository, ModelCostRepository],
  exports: [CourseRepository, UserRepository, ModelCostRepository],
})
export class DataModule {}