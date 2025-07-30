import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from './database/entities/course.entity';
import { Module as LearningModule } from './database/entities/module.entity';
import { Lesson } from './database/entities/lesson.entity';
import { Progress } from './database/entities/progress.entity';
import { User } from './database/entities/user.entity';
import { ArxivModule } from './arxiv/arxiv.module';
import { PaperModule } from './paper/paper.module';
import { GenerationModule } from './generation/generation.module';
import { CourseModule } from './course/course.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'database.sqlite',
      entities: [Course, LearningModule, Lesson, Progress, User],
      synchronize: true,
    }),
    ArxivModule,
    PaperModule,
    GenerationModule,
    CourseModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
