import { Module } from '@nestjs/common';
import { CourseService } from './course/course.service';
import { DataModule } from '../data/data.module';
import { GenerationModule } from '../generation/generation.module';
import { AuthModule } from '../auth/auth.module';
import { CourseController } from './course/course.controller';
import { CourseGateway } from './course/course.gateway';

@Module({
  imports: [
    AuthModule,
    DataModule,
    GenerationModule,
  ],
  providers: [CourseService, CourseGateway],
  exports: [CourseService, CourseGateway],
  controllers: [CourseController],
})
export class CourseModule {}
