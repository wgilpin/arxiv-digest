import { Controller, Get, Post, Body, Res, Param } from '@nestjs/common';
import { Response } from 'express';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../database/entities/course.entity';
import { CourseService } from '../course/course/course.service';

@Controller()
export class PaperController {
  constructor(
    private readonly arxivService: ArxivService,
    private readonly generationService: GenerationService,
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    private readonly courseService: CourseService,
  ) {}

  @Get('/')
  getPaperForm(@Res() res: Response) {
    res.send(`
      <![CDATA[<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Submit ArXiv ID</title>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
      </head>
      <body>
        <div class="min-h-screen flex items-center justify-center bg-base-200">
          <div class="card w-96 bg-base-100 shadow-xl p-8">
            <h1 class="text-2xl font-bold mb-4 text-center">Submit ArXiv ID</h1>
            <form action="/paper" method="POST" class="form-control">
              <label for="arxivId" class="label"><span class="label-text">ArXiv ID:</span></label>
              <input type="text" id="arxivId" name="arxivId" required class="input input-bordered w-full">
              <button type="submit" class="btn btn-primary mt-4">Create Course</button>
            </form>
          </div>
        </div>
      </body>
      </html>]]>
    `);
  }

  @Post('/')
  async createCourse(@Body('arxivId') arxivId: string, @Res() res: Response) {
    const paperTitle = await this.arxivService.fetchPaperTitle(arxivId);
    const paperText = await this.arxivService.getPaperText(arxivId);
    const extractedConcepts =
      await this.generationService.extractConcepts(paperText);

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
      conceptsHtml = course.extractedConcepts
        .map(
          (concept) => `
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">${concept}:</span>
          </label>
          <select name="rating-${concept}" class="select select-bordered w-full">
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </div>
      `,
        )
        .join('');
    } else {
      conceptsHtml = `
        <p class="text-center text-gray-500">No concepts extracted for this paper.</p>
      `;
    }

    res.send(`
      <![CDATA[<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Assess Concepts for: ${course.paperTitle}</title>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
      </head>
      <body>
        <div class="min-h-screen flex items-center justify-center bg-base-200">
          <div class="card w-96 bg-base-100 shadow-xl p-8">
            <h1 class="text-2xl font-bold mb-4 text-center">Assess Concepts for: ${course.paperTitle}</h1>
            <form action="/papers/${course.id}/assess" method="POST" class="form-control">
              ${conceptsHtml}
              <button type="submit" class="btn btn-primary mt-4">Submit Assessment</button>
            </form>
          </div>
        </div>
      </body>
      </html>]]>
    `);
  }

  @Post('/:id/assess')
  async submitAssessment(
    @Param('id') id: number,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const ratings: Record<string, number> = {};
    for (const key in body) {
      if (key.startsWith('rating-')) {
        const conceptName = key.replace('rating-', '');
        ratings[conceptName] = parseInt(body[key], 10);
      }
    }

    await this.courseService.generateSyllabus(id, ratings);

    res.redirect(`/courses/${id}`);
  }
}
