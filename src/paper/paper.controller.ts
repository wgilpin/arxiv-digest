import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Param,
  NotFoundException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { CourseRepository } from '../data/repositories/course.repository';
import { CourseService } from '../course/course/course.service';
import { TemplateHelper } from '../templates/template-helper';

@Controller()
export class PaperController {
  constructor(
    private readonly arxivService: ArxivService,
    private readonly generationService: GenerationService,
    private readonly courseRepository: CourseRepository,
    private readonly courseService: CourseService,
  ) {}

  private formatDate(date: any): string {
    try {
      if (date instanceof Date) {
        return date.toLocaleDateString();
      }
      if (date && typeof date.toDate === 'function') {
        // Firestore Timestamp
        return date.toDate().toLocaleDateString();
      }
      if (typeof date === 'string' || typeof date === 'number') {
        const parsedDate = new Date(date);
        const dateString = parsedDate.toLocaleDateString();
        if (dateString === 'Invalid Date') {
          return 'Invalid date';
        }
        return dateString;
      }
      return 'Unknown date';
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  }

  private escapeJavaScript(str: any): string {
    if (str == null) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  @Get('/')
  @UseGuards(AuthGuard)
  async getDashboard(@Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    const courses = await this.courseRepository.findAll(req.user.uid);

    let coursesHtml = '';
    if (courses.length > 0) {
      // Calculate costs for all courses efficiently
      const courseCosts = await this.courseService.calculateMultipleCoursesCosts(courses);
      
      coursesHtml = courses
        .map(
          (course) => {
            const cost = courseCosts[course.id || ''] || 0;
            const costDisplay = cost > 0 ? `$${cost.toFixed(4)}` : 'Free';
            
            return `
        <div class="card bg-base-200 shadow-sm mb-4">
          <div class="card-body">
            <h3 class="card-title text-lg">${course.paperTitle}</h3>
            <p class="text-sm text-gray-600 mb-2">ArXiv ID: ${
              course.arxivId
            }</p>
            <p class="text-sm text-gray-600 mb-2">Created: ${this.formatDate(course.createdAt)}</p>
            <p class="text-sm text-green-600 mb-4">Generation Cost: <span class="font-semibold">${costDisplay}</span></p>
            <div class="card-actions justify-end">
              <a href="/courses/${
                course.id
              }" class="btn btn-primary btn-sm">View Course</a>
              <button class="btn btn-error btn-sm" onclick="confirmDelete('${this.escapeJavaScript(course.id)}')">Delete</button>
            </div>
          </div>
        </div>
      `;
          }
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
  async createCourse(@Body('arxivId') arxivId: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    try {
      const paperTitle = await this.arxivService.fetchPaperTitle(arxivId);
      const paperText = await this.arxivService.getPaperText(arxivId);
      const conceptsWithImportance = 
        await this.generationService.extractConceptsWithImportance(paperText);

      // Capture token usage from concept extraction
      const tokenUsageByModel = this.generationService.getAndResetTokenUsage();

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

      // Calculate legacy totals for backward compatibility
      let totalInput = 0, totalOutput = 0, totalTokens = 0;
      for (const usage of Object.values(tokenUsageByModel)) {
        totalInput += usage.inputTokens;
        totalOutput += usage.outputTokens;
        totalTokens += usage.totalTokens;
      }

      const courseId = await this.courseRepository.createCourse(req.user.uid, {
        arxivId: arxivId,
        title: paperTitle,
        description: `Learning course for ${paperTitle}`,
        paperTitle: paperTitle,
        paperAuthors: [], // TODO: Extract from ArXiv
        paperUrl: `https://arxiv.org/abs/${arxivId}`,
        modules: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        extractedConcepts: extractedConcepts,
        conceptImportance: conceptImportance,
        paperContent: paperText,
        tokenUsageByModel: tokenUsageByModel,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens: totalTokens,
      });

      res.redirect(`/${courseId}/assess`);
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
  @UseGuards(AuthGuard)
  async getAssessmentPage(@Param('id') id: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    const course = await this.courseRepository.findById(req.user.uid, id);

    if (!course) {
      return res.status(404).send('Course not found');
    }

    let conceptsHtml = '';
    if (course.extractedConcepts && course.extractedConcepts.length > 0) {
      conceptsHtml = course.extractedConcepts
        .map(
          (concept: string) => `
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
  @UseGuards(AuthGuard)
  async submitAssessment(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
    @Req() req: Request & { user: { uid: string } },
  ) {
    const ratings: Record<string, number> = {};
    for (const key in body) {
      if (key.startsWith('rating-')) {
        const conceptName = key.replace('rating-', '');
        ratings[conceptName] = parseInt(body[key], 10);
      }
    }

    await this.courseService.generateSyllabus(req.user.uid, id, ratings);

    res.redirect(`/courses/${id}`);
  }
}
