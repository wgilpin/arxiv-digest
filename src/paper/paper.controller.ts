import { Controller, Get, Post, Body, Res, Inject, Param } from '@nestjs/common';
import { Response } from 'express';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../database/entities/course.entity';

@Controller('paper')
export class PaperController {
  constructor(
    private readonly arxivService: ArxivService,
    private readonly generationService: GenerationService,
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
    const paperText = await this.arxivService.getPaperText(arxivId);
    const extractedConcepts = await this.generationService.extractConcepts(paperText);

    const newCourse = this.courseRepository.create({
      paperArxivId: arxivId,
      paperTitle: paperTitle,
      comprehensionLevel: 'beginner', // Default for now
      extractedConcepts: extractedConcepts,
    });

    await this.courseRepository.save(newCourse);

    res.redirect(`/papers/${newCourse.id}/assess`);
  }

  @Get('/:id/assess')
  async getAssessmentPage(@Param('id') id: number, @Res() res: Response) {
    const course = await this.courseRepository.findOneBy({ id });

    if (!course) {
      return res.status(404).send('Course not found');
    }

    let conceptsHtml = '';
    if (course.extractedConcepts && course.extractedConcepts.length > 0) {
      conceptsHtml = course.extractedConcepts.map(concept => `
        <div>
          <label>${concept}:</label>
          <select name="rating-${concept}">
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </div>
      `).join('');
    } else {
      conceptsHtml = '<p>No concepts extracted for this paper.</p>';
    }

    res.send(`
      <h1>Assess Concepts for: ${course.paperTitle}</h1>
      <form action="/papers/${course.id}/assess" method="POST">
        ${conceptsHtml}
        <button type="submit">Submit Assessment</button>
      </form>
    `);
  }
}
