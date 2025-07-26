import { Controller, Get, Post, Body, Res, Inject } from '@nestjs/common';
import { Response } from 'express';
import { ArxivService } from '../arxiv/arxiv.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../database/entities/course.entity';

@Controller('paper')
export class PaperController {
  constructor(
    private readonly arxivService: ArxivService,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
  ) {}

  @Get('/')
  getPaperForm(@Res() res: Response) {
    res.send(`
      <h1>Submit ArXiv ID</h1>
      <form action="/paper" method="POST">
        <label for="arxivId">ArXiv ID:</label>
        <input type="text" id="arxivId" name="arxivId" required>
        <button type="submit">Create Course</button>
      </form>
    `);
  }

  @Post('/')
  async createCourse(@Body('arxivId') arxivId: string, @Res() res: Response) {
    const paperTitle = await this.arxivService.fetchPaperTitle(arxivId);

    const newCourse = this.courseRepository.create({
      paperArxivId: arxivId,
      paperTitle: paperTitle,
      comprehensionLevel: 'beginner', // Default for now
    });

    await this.courseRepository.save(newCourse);

    res.send(`Course created for paper: ${paperTitle}`);
  }
}
