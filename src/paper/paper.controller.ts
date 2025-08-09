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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
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

  private formatDate(date: Date | string | number | { toDate: () => Date }): string {
    try {
      if (date instanceof Date) {
        return date.toLocaleDateString();
      }
      if (date && typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') {
        // Firestore Timestamp
        return (date as { toDate: () => Date }).toDate().toLocaleDateString();
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

  private escapeJavaScript(str: string | null | undefined): string {
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
            const costDisplay = cost > 0 ? `$${cost.toFixed(2)}` : 'Free';
            
            const sourceInfo = course.arxivId 
              ? `ArXiv ID: ${course.arxivId}`
              : `Source: Uploaded PDF`;
            
            return `
        <div class="card bg-base-200 shadow-sm mb-4">
          <div class="card-body">
            <h3 class="card-title text-lg">${course.paperTitle}</h3>
            <p class="text-sm text-gray-600 mb-2">${sourceInfo}</p>
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


  @Post('/upload')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('pdf'))
  async createCourseFromUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Res() res: Response,
    @Req() req: Request & { user: { uid: string } }
  ) {
    try {
      if (!file) {
        throw new BadRequestException('No PDF file uploaded');
      }

      if (file.mimetype !== 'application/pdf') {
        throw new BadRequestException('Only PDF files are allowed');
      }

      if (!title || title.trim().length === 0) {
        throw new BadRequestException('Paper title is required');
      }

      const cleanTitle = title.trim();
      
      // Extract text from uploaded PDF using LLM service
      const paperText = await this.arxivService.extractTextFromPdf(file.buffer);
      
      // Extract concepts from the paper text
      const conceptsWithImportance = 
        await this.generationService.extractConceptsWithImportance(paperText);

      // Order concepts by their conceptual dependencies
      const orderedConceptsWithImportance = 
        await this.generationService.orderConceptsByDependencies(conceptsWithImportance);

      // Capture token usage from PDF extraction, concept extraction, and ordering
      const tokenUsageByModel = this.generationService.getAndResetTokenUsage();

      // Extract concept names for backward compatibility (using ordered concepts)
      const extractedConcepts = orderedConceptsWithImportance.map(item => item.concept);
      
      // Create importance mapping (using ordered concepts)
      const conceptImportance: Record<string, { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string }> = {};
      orderedConceptsWithImportance.forEach(item => {
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
        arxivId: undefined, // No ArXiv ID for uploaded PDFs
        title: cleanTitle,
        description: `Learning course for ${cleanTitle}`,
        paperTitle: cleanTitle,
        paperAuthors: [], // Could be extracted from PDF metadata if needed
        paperUrl: undefined, // No URL for uploaded files
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
      if (error instanceof BadRequestException) {
        const html = TemplateHelper.renderTemplate('error-general.html', {
          errorMessage: error.message,
        });
        res.status(400).send(html);
      } else {
        console.error('PDF upload error:', error);
        const html = TemplateHelper.renderTemplate('error-general.html', {
          errorMessage: 'Failed to process uploaded PDF. Please try again.',
        });
        res.status(500).send(html);
      }
    }
  }

  @Post('/')
  @UseGuards(AuthGuard)
  async createCourse(@Body('arxivId') arxivId: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    console.log('=== POST / createCourse ===');
    console.log('Raw arxivId input:', arxivId);
    
    try {
      // Extract clean ArXiv ID from input (handles both URLs and raw IDs)
      console.log('Extracting ArXiv ID from:', arxivId);
      const cleanArxivId = this.arxivService.extractArxivId(arxivId);
      console.log('Clean ArXiv ID:', cleanArxivId);
      
      console.log('Fetching paper title...');
      const paperTitle = await this.arxivService.fetchPaperTitle(arxivId);
      console.log('Paper title:', paperTitle);
      
      console.log('Fetching paper text...');
      const paperText = await this.arxivService.getPaperText(arxivId);
      console.log('Paper text length:', paperText?.length || 0);
      const conceptsWithImportance = 
        await this.generationService.extractConceptsWithImportance(paperText);

      // Order concepts by their conceptual dependencies
      const orderedConceptsWithImportance = 
        await this.generationService.orderConceptsByDependencies(conceptsWithImportance);

      // Capture token usage from PDF extraction, concept extraction, and ordering
      const tokenUsageByModel = this.generationService.getAndResetTokenUsage();

      // Extract concept names for backward compatibility (using ordered concepts)
      const extractedConcepts = orderedConceptsWithImportance.map(item => item.concept);
      
      // Create importance mapping (using ordered concepts)
      const conceptImportance: Record<string, { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string }> = {};
      orderedConceptsWithImportance.forEach(item => {
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
        arxivId: cleanArxivId,
        title: paperTitle,
        description: `Learning course for ${paperTitle}`,
        paperTitle: paperTitle,
        paperAuthors: [], // TODO: Extract from ArXiv
        paperUrl: `https://arxiv.org/abs/${cleanArxivId}`,
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
      console.error('=== ERROR in createCourse ===');
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error?.message);
      console.error('Full error:', error);
      if (error instanceof Error) {
        console.error('Stack trace:', error.stack);
      }
      console.error('========================');
      
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

    return res.redirect(`/courses/${id}`);
  }
}
