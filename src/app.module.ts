import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirestoreModule } from './firestore/firestore.module';
import { StorageModule } from './storage/storage.module';
import { ArxivModule } from './arxiv/arxiv.module';
import { PaperModule } from './paper/paper.module';
import { GenerationModule } from './generation/generation.module';
import { CourseModule } from './course/course.module';
import { AuthModule } from './auth/auth.module';
import { DebugModule } from './debug/debug.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    FirestoreModule,
    StorageModule,
    ArxivModule,
    PaperModule,
    GenerationModule,
    CourseModule,
    AuthModule,
    DebugModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
