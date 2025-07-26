import { Controller, Get, Post, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CourseService } from './course.service';
import { Course } from '../../database/entities/course.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Module } from '../../database/entities/module.entity';
import { TemplateHelper } from '../../templates/template-helper';
import { marked } from 'marked';

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  /**
   * Converts mathematical notation from code tags to LaTeX format for MathJax
   */
  private convertMathCodeToLatex(html: string): string {
    // More comprehensive patterns to match various mathematical expressions
    const mathPatterns = [
      // Mathematical function calls: sin(...), cos(...), PE(...)
      /(<code>)([a-zA-Z]+\([^<>]*?\))(<\/code>)/g,
      // Variables with subscripts: X_1, d_model, etc.
      /(<code>)([A-Za-z]+_[A-Za-z0-9\{\}\+\-]+)(<\/code>)/g,
      // Variables with superscripts: 10000^(2i/d_model)
      /(<code>)([A-Za-z0-9]+\^[^<>]*?)(<\/code>)/g,
      // Complex mathematical expressions with parentheses and operators
      /(<code>)([A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]*[_\^\(\)][A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]*)(<\/code>)/g,
      // Variables ending with subscript patterns
      /(<code>)([A-Za-z_\\]+[_{][^<>]*[}]?[^<>]*?)(<\/code>)/g,
      // Probability notation and expectation
      /(<code>)(E\[[^\]]+\][^<>]*?)(<\/code>)/g,
      /(<code>)(P\([^<>]+\)[^<>]*?)(<\/code>)/g,
      // Mathematical operations and comparisons
      /(<code>)([A-Za-z]+\s*[>=<]\s*[0-9A-Za-z_]+)(<\/code>)/g,
      // Single mathematical variables that might be missed
      /(<code>)([a-z]_[a-zA-Z]+)(<\/code>)/g,
      // Numbers with exponents
      /(<code>)([0-9]+\^[^<>]+?)(<\/code>)/g,
    ];

    let result = html;
    
    for (const pattern of mathPatterns) {
      result = result.replace(pattern, (match, openTag, content, closeTag) => {
        // Only convert if it looks like mathematical notation
        if (this.isMathematicalContent(content)) {
          return `$${content}$`;
        }
        return match;
      });
    }

    return result;
  }

  /**
   * Determines if content looks like mathematical notation
   */
  private isMathematicalContent(content: string): boolean {
    // Check for mathematical patterns
    const mathIndicators = [
      /_\{?[A-Za-z0-9\+\-]+\}?/, // Subscripts
      /\^\{?[A-Za-z0-9\+\-\/\(\)]+\}?/, // Superscripts
      /^[A-Za-z]+_[A-Za-z0-9\+\-\{\}]+$/, // Simple variable with subscript
      /^[a-z]_[a-zA-Z]+$/, // Variables like d_model
      /^E\[/, // Expectation
      /^P\(/, // Probability
      /^[a-zA-Z]+\(/, // Mathematical functions like sin(, cos(, PE(
      /[>=<]/, // Comparison operators
      /\\mathcal/, // LaTeX commands
      /\\[a-zA-Z]+/, // Other LaTeX commands
      /[0-9]+\^/, // Numbers with exponents
      /\([^)]*\/[^)]*\)/, // Fractions in parentheses
      /pos/, // Common in positional encoding formulas
      /model/, // d_model is a common variable
    ];

    // Also check if it contains typical mathematical variable names
    const mathVariables = ['pos', 'model', 'sin', 'cos', 'PE'];
    const containsMathVar = mathVariables.some(mathVar => content.includes(mathVar));

    return mathIndicators.some(pattern => pattern.test(content)) || containsMathVar;
  }

  @Get('/:id')
  async getCoursePage(@Param('id') id: number, @Res() res: Response) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithProgress(id);

    if (!course) {
      return res.status(404).send('Course not found');
    }

    // Trigger background generation of next module if user is accessing course
    setImmediate(() => {
      this.courseService.generateNextModuleInBackground(id).catch(error => {
        console.error('Background generation failed:', error);
      });
    });

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(
          (module: Module) => {
            const hasLessons = module.lessons && module.lessons.length > 0;
            const isGenerating = !hasLessons;
            
            return `
        <div class="collapse collapse-plus bg-base-200 mb-2">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${module.title}
            ${isGenerating ? '<span class="loading loading-spinner loading-sm ml-2"></span>' : ''}
          </div>
          <div class="collapse-content"> 
            ${hasLessons ? `
            <ul class="list-disc list-inside">
              ${module.lessons
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((lesson: Lesson) => {
                  const isCompleted =
                    lesson.progress && lesson.progress.length > 0;
                  const completedClass = isCompleted ? 'text-success' : '';
                  const completedIcon = isCompleted ? '✓ ' : '';
                  return `
                <li class="${completedClass}">
                  <a href="/courses/lessons/${lesson.id}" class="link link-primary ${completedClass}">
                    ${completedIcon}${lesson.title}
                  </a>
                </li>
              `;
                })
                .join('')}
            </ul>
            ` : `
            <div class="flex items-center justify-center p-4">
              <span class="loading loading-spinner loading-md mr-2"></span>
              <span class="text-gray-500">Generating lessons...</span>
            </div>
            `}
          </div>
        </div>
      `;
          }
        )
        .join('');
    } else {
      modulesHtml = `
        <p class="text-center text-gray-500">No modules found for this course.</p>
      `;
    }

    const html = TemplateHelper.renderTemplate('course-page.html', {
      paperTitle: course.paperTitle,
      modulesHtml: modulesHtml,
    });
    res.send(html);
  }

  @Get('/:courseId/modules/:moduleIndex')
  async getModulePage(@Param('courseId') courseId: number, @Param('moduleIndex') moduleIndex: number, @Res() res: Response) {
    // Ensure the module exists, generating it if necessary
    const module = await this.courseService.ensureModuleExists(courseId, moduleIndex);
    
    if (!module) {
      return res.status(404).send('Module not found or invalid module index');
    }

    // Trigger background generation of next module
    setImmediate(() => {
      this.courseService.generateNextModuleInBackground(courseId).catch(error => {
        console.error('Background generation failed:', error);
      });
    });

    // Redirect to course page to show the module
    res.redirect(`/courses/${courseId}`);
  }

  @Get('/lessons/:id')
  async getLessonPage(@Param('id') id: number, @Res() res: Response) {
    const lesson: Lesson | null = await this.courseService.findLessonById(id);

    if (!lesson) {
      return res.status(404).send('Lesson not found');
    }

    // Trigger background generation of next module when user accesses lessons
    const courseId = lesson.module.course.id;
    setImmediate(() => {
      this.courseService.generateNextModuleInBackground(courseId).catch(error => {
        console.error('Background generation failed:', error);
      });
    });

    // Convert markdown to HTML
    let lessonContentHtml = await marked(lesson.content);
    
    // Post-process to convert mathematical notation from code tags to LaTeX
    lessonContentHtml = this.convertMathCodeToLatex(lessonContentHtml);
    
    const html = TemplateHelper.renderTemplate('lesson-page.html', {
      lessonTitle: lesson.title,
      lessonContent: lessonContentHtml,
      courseId: lesson.module.course.id,
      lessonId: lesson.id,
    });
    res.send(html);
  }

  @Post('/lessons/:id/complete')
  async markLessonComplete(
    @Param('id') lessonId: number,
    @Res() res: Response,
  ) {
    try {
      await this.courseService.markLessonComplete(lessonId);

      // Get the lesson to find the course ID for redirect
      const lesson = await this.courseService.findLessonById(lessonId);
      if (lesson) {
        res.redirect(`/courses/${lesson.module.course.id}`);
      } else {
        res.status(404).send('Lesson not found');
      }
    } catch (error) {
      console.error('Error marking lesson complete:', error);
      res.status(500).send('Error marking lesson complete');
    }
  }
}
