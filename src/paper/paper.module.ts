import { Module } from '@nestjs/common';
import { PaperController } from './paper.controller';
import { ArxivService } from '../arxiv/arxiv.service';
import { DataModule } from '../data/data.module';
import { ArxivModule } from '../arxiv/arxiv.module';
import { GenerationModule } from '../generation/generation.module';
import { CourseModule } from '../course/course.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    DataModule,
    ArxivModule,
    GenerationModule,
    CourseModule,
  ],
  controllers: [PaperController],
  providers: [ArxivService],
})
export class PaperModule {}
