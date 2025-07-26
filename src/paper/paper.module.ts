import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaperController } from './paper.controller';
import { ArxivService } from '../arxiv/arxiv.service';
import { Course } from '../database/entities/course.entity';
import { ArxivModule } from '../arxiv/arxiv.module';
import { GenerationModule } from '../generation/generation.module';
import { CourseModule } from '../course/course.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course]),
    ArxivModule,
    GenerationModule,
    CourseModule,
  ],
  controllers: [PaperController],
  providers: [ArxivService],
})
export class PaperModule {}
