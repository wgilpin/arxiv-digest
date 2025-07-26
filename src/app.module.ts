import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from './database/entities/course.entity';
import { Module as LearningModule } from './database/entities/module.entity';
import { Lesson } from './database/entities/lesson.entity';
import { Progress } from './database/entities/progress.entity';
import { ArxivModule } from './arxiv/arxiv.module';
import { PaperModule } from './paper/paper.module';
import { GenerationModule } from './generation/generation.module';
import { CourseModule } from './course/course.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'database.sqlite',
      entities: [Course, LearningModule, Lesson, Progress],
      synchronize: true,
    }),
    ArxivModule,
    PaperModule,
    GenerationModule,
    CourseModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
