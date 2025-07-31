import { Module } from '@nestjs/common';
import { PaperController } from './paper.controller';
import { DataModule } from '../data/data.module';
import { ArxivModule } from '../arxiv/arxiv.module';
import { GenerationModule } from '../generation/generation.module';
import { CourseModule } from '../course/course.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    AuthModule,
    DataModule,
    ArxivModule,
    GenerationModule,
    CourseModule,
    StorageModule,
  ],
  controllers: [PaperController],
  providers: [], // Removed ArxivService - it should come from ArxivModule
})
export class PaperModule {}
