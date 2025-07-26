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
    // Pattern to match code tags containing mathematical notation
    // Look for variables with subscripts/superscripts, mathematical symbols, etc.
    const mathPatterns = [
      // Variables with subscripts/superscripts: X_1, X_{t+1}, P(H|E), etc.
      /(<code>)([A-Za-z_\\]+[_{][^<>]*[}]?[^<>]*?)(<\/code>)/g,
      /(<code>)([A-Za-z]+_[A-Za-z0-9\+\-\{\}]+)(<\/code>)/g,
      /(<code>)([A-Za-z]+\^[A-Za-z0-9\+\-\{\}]+)(<\/code>)/g,
      // Mathematical expressions with operators, parentheses, etc.
      /(<code>)([A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]+[_\^][A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]*)(<\/code>)/g,
      // Probability notation and functions
      /(<code>)(E\[[^\]]+\][^<>]*?)(<\/code>)/g,
      /(<code>)(P\([^<>]+\)[^<>]*?)(<\/code>)/g,
      // Mathematical symbols and operations
      /(<code>)([A-Za-z]+\s*[>=<]\s*[0-9A-Za-z_]+)(<\/code>)/g,
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
      /\^\{?[A-Za-z0-9\+\-]+\}?/, // Superscripts
      /^[A-Za-z]+_[A-Za-z0-9\+\-\{\}]+$/, // Simple variable with subscript
      /^E\[/, // Expectation
      /^P\(/, // Probability
      /[>=<]/, // Comparison operators
      /\\mathcal/, // LaTeX commands
      /\\[a-zA-Z]+/, // Other LaTeX commands
    ];

    return mathIndicators.some(pattern => pattern.test(content));
  }

  @Get('/:id')
  async getCoursePage(@Param('id') id: number, @Res() res: Response) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithProgress(id);

    if (!course) {
      return res.status(404).send('Course not found');
    }

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .map(
          (module: Module) => `
        <div class="collapse collapse-plus bg-base-200 mb-2">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${module.title}
          </div>
          <div class="collapse-content"> 
            <ul class="list-disc list-inside">
              ${module.lessons
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
          </div>
        </div>
      `,
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

  @Get('/lessons/:id')
  async getLessonPage(@Param('id') id: number, @Res() res: Response) {
    const lesson: Lesson | null = await this.courseService.findLessonById(id);

    if (!lesson) {
      return res.status(404).send('Lesson not found');
    }

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
