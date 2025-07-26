import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaperController } from './paper.controller';
import { ArxivService } from '../arxiv/arxiv.service';
import { Course } from '../database/entities/course.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Course])],
  controllers: [PaperController],
  providers: [ArxivService],
})
export class PaperModule {}
