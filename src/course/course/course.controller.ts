/* eslint-disable no-useless-escape */
import { Controller, Get, Post, Delete, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CourseService } from './course.service';
import { Course } from '../../database/entities/course.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Module } from '../../database/entities/module.entity';
import { TemplateHelper } from '../../templates/template-helper';
import { marked } from 'marked';

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {
    console.log('CourseController initialized with DELETE route handler');
  }

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
      result = result.replace(pattern, (match, openTag, content, _) => {
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
    const containsMathVar = mathVariables.some((mathVar) =>
      content.includes(mathVar),
    );

    return (
      mathIndicators.some((pattern) => pattern.test(content)) || containsMathVar
    );
  }

  @Get('/:id')
  async getCoursePage(@Param('id') id: number, @Res() res: Response) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithProgress(id);

    if (!course) {
      return res.status(404).send('Course not found');
    }

    // Start lesson content generation before rendering page (so spinner shows)
    this.courseService
      .prepareNextLesson(id)
      .then(() => {
        // Generate remaining lesson titles for modules that don't have them yet
        return this.courseService.generateRemainingLessonTitles(id);
      })
      .catch((error) => {
        console.error('Course initialization failed:', error);
      });

    // Don't wait for generation to complete, but ensure it starts before rendering

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((module: Module) => {
          const hasLessons = module.lessons && module.lessons.length > 0;
          
          // Check if this module is actively generating lesson content
          let showModuleSpinner = false;
          if (hasLessons) {
            // Find the next lesson that should be generated globally
            const allLessons = course.modules
              ?.flatMap(m => (m.lessons || []).map(l => ({ ...l, moduleOrderIndex: m.orderIndex })))
              .sort((a, b) => {
                const moduleOrderDiff = a.moduleOrderIndex - b.moduleOrderIndex;
                if (moduleOrderDiff !== 0) return moduleOrderDiff;
                return a.orderIndex - b.orderIndex;
              }) || [];
            
            const nextLessonToGenerate = allLessons.find(l => !l.content);

            // A lesson in this module is being generated if the next lesson to generate is in this module
            // and the generation service confirms it's being generated.
            const isGenerating = nextLessonToGenerate && this.courseService.isLessonBeingGenerated(nextLessonToGenerate.id);

            // Show module spinner only if the next lesson to generate is in this module AND generation is active
            showModuleSpinner = !!(nextLessonToGenerate && 
                                   nextLessonToGenerate.moduleOrderIndex === module.orderIndex && 
                                   isGenerating);
          }

          return `
        <div class="collapse collapse-plus bg-base-200 mb-2">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${module.title}
            ${showModuleSpinner ? '<span class="loading loading-spinner loading-sm ml-2"></span>' : ''}
          </div>
          <div class="collapse-content"> 
            ${
              hasLessons
                ? `
            <ul class="space-y-1">
              ${module.lessons
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((lesson: Lesson, _: number) => {
                  const isCompleted =
                    lesson.progress && lesson.progress.length > 0;
                  const hasContent = lesson.content !== null;
                  const completedClass = isCompleted ? 'btn-success' : hasContent ? 'btn-primary' : 'btn-outline btn-secondary';
                  const completedIcon = isCompleted ? '<span class="mr-2">✓</span>' : '';
                  
                  // Only show spinner on lessons that are actually being generated
                  let loadingIcon = '';
                  if (!hasContent && this.courseService.isLessonBeingGenerated(lesson.id)) {
                    loadingIcon = '<span class="loading loading-spinner loading-xs ml-2"></span>';
                  }

                  return `
                <li class="mb-2">
                  <a href="/courses/lessons/${lesson.id}" class="btn ${completedClass} w-full justify-start text-left">
                    ${completedIcon}
                    <span class="flex-1 truncate">${lesson.title}</span>
                    ${loadingIcon}
                  </a>
                </li>
              `;
                })
                .join('')}
            </ul>
            `
                : `
            <div class="flex items-center justify-center p-4">
              <span class="loading loading-spinner loading-md mr-2"></span>
              <span class="text-gray-500">Generating lesson titles...</span>
            </div>
            `
            }
          </div>
        </div>
      `;
        })
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

  @Get('/:courseId/status')
  async getCourseStatus(
    @Param('courseId') courseId: number,
    @Res() res: Response,
  ) {
    const course =
      await this.courseService.findCourseByIdWithProgress(courseId);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const plannedConcepts: string[] =
      typeof course.plannedConcepts === 'string'
        ? (course.plannedConcepts).split(',')
        : Array.isArray(course.plannedConcepts)
          ? (course.plannedConcepts as string[])
          : [];
    const moduleStatuses = plannedConcepts.map((concept, index) => {
      const module = course.modules?.find((m) => m.orderIndex === index);
      const totalLessons = module?.lessons?.length || 0;
      const lessonsWithContent =
        module?.lessons?.filter(
          (l): l is Lesson =>
            !!l &&
            typeof l === 'object' &&
            'content' in l &&
            (l).content !== null,
        ).length || 0;
      const hasContent = totalLessons > 0;

      console.log(
        `Status check - Module ${index} (${concept}): moduleExists=${!!module}, totalLessons=${totalLessons}, lessonsWithContent=${lessonsWithContent}, hasContent=${hasContent}`,
      );

      return {
        orderIndex: index,
        title: concept,
        hasContent,
        lessonCount: totalLessons,
        lessonsWithContent,
        moduleId: module?.id,
      };
    });

    const completedCount = moduleStatuses.filter((m) => m.hasContent).length;

    // Calculate total lesson counts
    const totalLessonTitles = moduleStatuses.reduce(
      (sum, module) => sum + module.lessonCount,
      0,
    );
    const totalLessonsWithContent = moduleStatuses.reduce(
      (sum, module) => sum + module.lessonsWithContent,
      0,
    );

    console.log(
      `Status summary: ${completedCount}/${plannedConcepts.length} modules, ${totalLessonsWithContent}/${totalLessonTitles} lessons with content`,
    );

    res.json({
      courseId: course.id,
      paperTitle: course.paperTitle,
      totalModules: plannedConcepts.length,
      completedModules: completedCount,
      totalLessonTitles: totalLessonTitles,
      totalLessonsWithContent: totalLessonsWithContent,
      modules: moduleStatuses,
    });
  }

  @Get('/:courseId/modules-html')
  async getModulesHtml(
    @Param('courseId') courseId: number,
    @Res() res: Response,
  ) {
    const course =
      await this.courseService.findCourseByIdWithProgress(courseId);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((module: Module) => {
          const hasLessons = module.lessons && module.lessons.length > 0;
          
          // Check if this module is actively generating lesson content
          let showModuleSpinner = false;
          if (hasLessons) {
            // Find the next lesson that should be generated globally
            const allLessons = course.modules
              ?.flatMap(m => (m.lessons || []).map(l => ({ ...l, moduleOrderIndex: m.orderIndex })))
              .sort((a, b) => {
                const moduleOrderDiff = a.moduleOrderIndex - b.moduleOrderIndex;
                if (moduleOrderDiff !== 0) return moduleOrderDiff;
                return a.orderIndex - b.orderIndex;
              }) || [];
            
            const nextLessonToGenerate = allLessons.find(l => !l.content);

            // A lesson in this module is being generated if the next lesson to generate is in this module
            // and the generation service confirms it's being generated.
            const isGenerating = nextLessonToGenerate && this.courseService.isLessonBeingGenerated(nextLessonToGenerate.id);

            // Show module spinner only if the next lesson to generate is in this module AND generation is active
            showModuleSpinner = !!(nextLessonToGenerate && 
                                   nextLessonToGenerate.moduleOrderIndex === module.orderIndex && 
                                   isGenerating);
          }

          return `
        <div class="collapse collapse-plus bg-base-200 mb-2" data-module-id="${module.id}">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${module.title}
            ${showModuleSpinner ? '<span class="loading loading-spinner loading-sm ml-2"></span>' : ''}
          </div>
          <div class="collapse-content"> 
            ${
              hasLessons
                ? `
            <ul class="space-y-1">
              ${module.lessons
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((lesson: Lesson, _: number) => {
                  const isCompleted =
                    lesson.progress && lesson.progress.length > 0;
                  const hasContent = lesson.content !== null;
                  const completedClass = isCompleted ? 'btn-success' : hasContent ? 'btn-primary' : 'btn-outline btn-secondary';
                  const completedIcon = isCompleted ? '<span class="mr-2">✓</span>' : '';
                  
                  // Only show spinner on lessons that are actually being generated
                  let loadingIcon = '';
                  if (!hasContent && this.courseService.isLessonBeingGenerated(lesson.id)) {
                    loadingIcon = '<span class="loading loading-spinner loading-xs ml-2"></span>';
                  }

                  return `
                <li class="mb-2">
                  <a href="/courses/lessons/${lesson.id}" class="btn ${completedClass} w-full justify-start text-left">
                    ${completedIcon}
                    <span class="flex-1 truncate">${lesson.title}</span>
                    ${loadingIcon}
                  </a>
                </li>
              `;
                })
                .join('')}
            </ul>
            `
                : `
            <div class="flex items-center justify-center p-4">
              <span class="loading loading-spinner loading-md mr-2"></span>
              <span class="text-gray-500">Generating lesson titles...</span>
            </div>
            `
            }
          </div>
        </div>
      `;
        })
        .join('');
    }

    res.json({ modulesHtml });
  }

  @Get('/:courseId/modules/:moduleIndex')
  async getModulePage(
    @Param('courseId') courseId: number,
    @Param('moduleIndex') moduleIndex: number,
    @Res() res: Response,
  ) {
    // Ensure the module exists, generating it if necessary
    const module = await this.courseService.ensureModuleExists(
      courseId,
      moduleIndex,
    );

    if (!module) {
      return res.status(404).send('Module not found or invalid module index');
    }

    // Prepare next lesson
    setImmediate(() => {
      this.courseService.prepareNextLesson(courseId).catch((error) => {
        console.error('Lesson preparation failed:', error);
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

    // Prepare next lesson when user accesses a lesson
    const courseId = lesson.module.course.id;
    console.log(`User accessed lesson ${lesson.id} (${lesson.title}), triggering background generation for course ${courseId}`);
    
    setImmediate(() => {
      this.courseService.prepareNextLesson(courseId).catch((error) => {
        console.error('Background lesson preparation failed:', error);
      });
    });

    // Check if lesson has content
    if (!lesson.content) {
      // Start generating this specific lesson and show loading page
      setImmediate(() => {
        this.courseService.generateSpecificLesson(lesson.id).catch((error) => {
          console.error('On-demand lesson generation failed:', error);
        });
      });

      const html = TemplateHelper.renderTemplate('lesson-loading.html', {
        lessonTitle: lesson.title,
        courseId: lesson.module.course.id,
        lessonId: lesson.id,
      });
      return res.send(html);
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
        const courseId = lesson.module.course.id;
        console.log(`User completed lesson ${lessonId} (${lesson.title}), triggering background generation for course ${courseId}`);
        
        // Trigger background generation of next lesson
        setImmediate(() => {
          this.courseService.prepareNextLesson(courseId).catch((error) => {
            console.error('Background lesson preparation after completion failed:', error);
          });
        });
        
        res.redirect(`/courses/${courseId}`);
      } else {
        res.status(404).send('Lesson not found');
      }
    } catch (error) {
      console.error('Error marking lesson complete:', error);
      res.status(500).send('Error marking lesson complete');
    }
  }

  @Get('/:courseId/generation-status')
  async getGenerationStatus(
    @Param('courseId') courseId: number,
    @Res() res: Response,
  ) {
    try {
      const course = await this.courseService.findCourseByIdWithProgress(courseId);
      
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      // Get all lessons and check which ones are being generated
      const generatingLessons: number[] = [];
      
      if (course.modules) {
        for (const module of course.modules) {
          if (module.lessons) {
            for (const lesson of module.lessons) {
              if (this.courseService.isLessonBeingGenerated(lesson.id)) {
                generatingLessons.push(lesson.id);
              }
            }
          }
        }
      }

      res.json({
        courseId,
        generatingLessons,
      });
    } catch (error) {
      console.error('Error getting generation status:', error);
      res.status(500).json({ error: 'Failed to get generation status' });
    }
  }

  @Delete('/:id')
  async deleteCourse(@Param('id') id: number, @Res() res: Response) {
    console.log(`DELETE request received for course ID: ${id}`);
    
    try {
      await this.courseService.deleteCourse(id);
      console.log(`Successfully deleted course ${id}`);
      res.status(200).json({ message: 'Course deleted successfully' });
    } catch (error) {
      console.error('Error deleting course:', error);
      
      if (error.message && error.message.includes('not found')) {
        res.status(404).json({ error: 'Course not found' });
      } else {
        res.status(500).json({ error: 'Failed to delete course' });
      }
    }
  }
}
