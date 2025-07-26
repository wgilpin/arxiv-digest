import { Module } from '@nestjs/common';
import { CourseService } from './course/course.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../database/entities/course.entity';
import { Module as CourseModuleEntity } from '../database/entities/module.entity';
import { Lesson } from '../database/entities/lesson.entity';
import { GenerationModule } from '../generation/generation.module';
import { CourseController } from './course/course.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, CourseModuleEntity, Lesson]),
    GenerationModule,
  ],
  providers: [CourseService],
  exports: [CourseService],
  controllers: [CourseController],
})
export class CourseModule {}
