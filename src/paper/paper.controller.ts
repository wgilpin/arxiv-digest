import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Param,
  NotFoundException,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../database/entities/course.entity';
import { CourseService } from '../course/course/course.service';
import { TemplateHelper } from '../templates/template-helper';

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
  @UseGuards(AuthGuard)
  async getDashboard(@Res() res: Response, @Req() req: Request & { user: any }) {
    const courses = await this.courseRepository.find({
      where: { userUid: req.user.uid },
      order: { createdAt: 'DESC' },
    });

    let coursesHtml = '';
    if (courses.length > 0) {
      coursesHtml = courses
        .map(
          (course) => `
        <div class="card bg-base-200 shadow-sm mb-4">
          <div class="card-body">
            <h3 class="card-title text-lg">${course.paperTitle}</h3>
            <p class="text-sm text-gray-600 mb-2">ArXiv ID: ${
              course.paperArxivId
            }</p>
            <p class="text-sm text-gray-600 mb-4">Created: ${course.createdAt.toLocaleDateString()}</p>
            <div class="card-actions justify-end">
              <a href="/courses/${
                course.id
              }" class="btn btn-primary btn-sm">View Course</a>
              <button class="btn btn-error btn-sm" onclick="confirmDelete(${
                course.id
              })">Delete</button>
            </div>
          </div>
        </div>
      `,
        )
        .join('');
    } else {
      coursesHtml = `
        <div class="text-center text-gray-500 py-8">
          <p class="text-lg mb-2">No courses yet</p>
          <p>Create your first course by entering an ArXiv ID above!</p>
        </div>
      `;
    }

    const html = TemplateHelper.renderTemplate('dashboard.html', {
      coursesHtml: coursesHtml,
    });
    res.send(html);
  }


  @Post('/')
  @UseGuards(AuthGuard)
  async createCourse(@Body('arxivId') arxivId: string, @Res() res: Response, @Req() req: Request & { user: any }) {
    try {
      const paperTitle = await this.arxivService.fetchPaperTitle(arxivId);
      const paperText = await this.arxivService.getPaperText(arxivId);
      const conceptsWithImportance = 
        await this.generationService.extractConceptsWithImportance(paperText);

      // Extract concept names for backward compatibility
      const extractedConcepts = conceptsWithImportance.map(item => item.concept);
      
      // Create importance mapping
      const conceptImportance: Record<string, { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string }> = {};
      conceptsWithImportance.forEach(item => {
        conceptImportance[item.concept] = {
          importance: item.importance,
          reasoning: item.reasoning
        };
      });

      const newCourse = this.courseRepository.create({
        paperArxivId: arxivId,
        paperTitle: paperTitle,
        comprehensionLevel: 'beginner', // Default for now
        extractedConcepts: extractedConcepts,
        conceptImportance: conceptImportance,
        paperContent: paperText,
        userUid: req.user.uid,
      });

      await this.courseRepository.save(newCourse);

      res.redirect(`/${newCourse.id}/assess`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        const html = TemplateHelper.renderTemplate('error-not-found.html', {
          errorMessage: error.message,
        });
        res.status(404).send(html);
      } else {
        const html = TemplateHelper.renderTemplate('error-general.html');
        res.status(500).send(html);
      }
    }
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
            <option value="0">0 - No knowledge of the concept</option>
            <option value="1">1 - Basic understanding of the concept</option>
            <option value="2">2 - Fair understanding of the concept without technical details</option>
            <option value="3">3 - Detailed technical understanding of the concept</option>
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

    const html = TemplateHelper.renderTemplate('assessment.html', {
      paperTitle: course.paperTitle,
      courseId: course.id,
      conceptsHtml: conceptsHtml,
    });
    res.send(html);
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
