/* eslint-disable no-useless-escape */
import { Controller, Get, Post, Delete, Param, Res, UseGuards, Req, Body } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { CourseService } from './course.service';
import { Course, Lesson, Module } from '../../firestore/interfaces/firestore.interfaces';
import { TemplateHelper } from '../../templates/template-helper';
import { debugLog } from 'src/common/debug-logger';
const { marked } = require('marked');

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {
    debugLog('CourseController initialized');
  }

  /**
   * Converts mathematical notation from code tags to LaTeX format for MathJax
   */
  private convertMathCodeToLatex(html: string): string {
    // More comprehensive patterns to match various mathematical expressions
    const mathPatterns = [
      /(<code>)([a-zA-Z]+\([^<>]*?\))(<\/code>)/g,
      /(<code>)([A-Za-z]+_[A-Za-z0-9\{\}\+\-]+)(<\/code>)/g,
      /(<code>)([A-Za-z0-9]+\^[^<>]*?)(<\/code>)/g,
      /(<code>)([A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]*[_\^\(\)][A-Za-z0-9_\{\}\^\+\-\*\/\(\)\|\[\]\\>=<\s]*)(<\/code>)/g,
      /(<code>)([A-Za-z_\\]+[_{][^<>]*[}]?[^<>]*?)(<\/code>)/g,
      /(<code>)(E\[[^\]]+\][^<>]*?)(<\/code>)/g,
      /(<code>)(P\([^<>]+\)[^<>]*?)(<\/code>)/g,
      /(<code>)([A-Za-z]+\s*[>=<]\s*[0-9A-Za-z_]+)(<\/code>)/g,
      /(<code>)([a-z]_[a-zA-Z]+)(<\/code>)/g,
      /(<code>)([0-9]+\^[^<>]+?)(<\/code>)/g,
    ];

    let result = html;

    for (const pattern of mathPatterns) {
      result = result.replace(pattern, (match, openTag, content, _) => {
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
    const mathIndicators = [
      /_\{?[A-Za-z0-9\+\-]+\}?/,
      /\^\{?[A-Za-z0-9\+\-\/\(\)]+\}?/,
      /^[A-Za-z]+_[A-Za-z0-9\+\-\{\}]+$/,
      /^[a-z]_[a-zA-Z]+$/,
      /^E\[/,
      /^P\(/,
      /^[a-zA-Z]+\(/,
      /[>=<]/,
      /\\mathcal/,
      /\\[a-zA-Z]+/,
      /[0-9]+\^/,
      /\([^)]*\/[^)]*\)/,
      /pos/,
      /model/,
    ];

    const mathVariables = ['pos', 'model', 'sin', 'cos', 'PE'];
    const containsMathVar = mathVariables.some((mathVar) =>
      content.includes(mathVar),
    );

    return (
      mathIndicators.some((pattern) => pattern.test(content)) || containsMathVar
    );
  }

  /**
   * Gets importance information for a module concept
   */
  private getConceptImportance(course: Course, conceptName: string): { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string } | null {
    if (!course.conceptImportance) {
      return null;
    }
    return course.conceptImportance[conceptName] || null;
  }

  /**
   * Creates an importance badge for display
   */
  private createImportanceBadge(importance: 'central' | 'supporting' | 'peripheral'): string {
    const badgeClasses = {
      central: 'badge-error',
      supporting: 'badge-warning', 
      peripheral: 'badge-info'
    };
    
    const labels = {
      central: 'Central',
      supporting: 'Supporting',
      peripheral: 'Peripheral'
    };

    return `<span class="badge ${badgeClasses[importance]} badge-sm ml-2">${labels[importance]}</span>`;
  }

  /**
   * Gets navigation information for a lesson (previous/next lesson)
   */
  private getLessonNavigation(course: Course, currentModuleIndex: number, currentLessonIndex: number): {
    previous: { moduleIndex: number; lessonIndex: number; title: string; hasContent: boolean } | null;
    next: { moduleIndex: number; lessonIndex: number; title: string; hasContent: boolean } | null;
  } {
    if (!course?.modules) {
      return { previous: null, next: null };
    }

    // Build a flat list of all lessons with their indices
    const allLessons: Array<{
      moduleIndex: number;
      lessonIndex: number;
      title: string;
      hasContent: boolean;
    }> = [];

    course.modules.forEach((module, moduleIndex) => {
      if (module.lessons) {
        module.lessons.forEach((lesson, lessonIndex) => {
          allLessons.push({
            moduleIndex,
            lessonIndex,
            title: lesson.title,
            hasContent: !!(lesson.content && lesson.content !== '')
          });
        });
      }
    });

    // Find current lesson in the flat list
    const currentIndex = allLessons.findIndex(
      lesson => lesson.moduleIndex === currentModuleIndex && lesson.lessonIndex === currentLessonIndex
    );

    if (currentIndex === -1) {
      return { previous: null, next: null };
    }

    return {
      previous: currentIndex > 0 ? allLessons[currentIndex - 1] : null,
      next: currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null
    };
  }


  @Get('/:id/modules-html')
  @UseGuards(AuthGuard)
  async getModulesHtml(@Param('id') id: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithRelations(req.user.uid, id);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .map((module: Module, moduleIndex: number) => {
          const importanceInfo = this.getConceptImportance(course, module.title);
          const importanceBadge = importanceInfo ? this.createImportanceBadge(importanceInfo.importance) : '';
          const hasLessons = module.lessons && module.lessons.length > 0;
          
          // Check if all lessons in this module are completed
          const allLessonsCompleted = hasLessons && module.lessons.every(lesson => 
            lesson.completedAt !== undefined
          );
          const moduleCompletedIcon = allLessonsCompleted ? '<span class="text-green-500 mr-2">✓</span>' : '';
          
          // Check if this module is actively generating lesson content
          let showModuleSpinner = false;
          if (hasLessons) {
            // Find the next lesson that should be generated globally
            const allLessons = course.modules
              ?.flatMap((m, mIndex) => (m.lessons || []).map((l, lIndex) => ({ ...l, moduleIndex: mIndex, lessonIndex: lIndex })))
              .sort((a, b) => {
                const moduleOrderDiff = a.moduleIndex - b.moduleIndex;
                if (moduleOrderDiff !== 0) return moduleOrderDiff;
                return a.lessonIndex - b.lessonIndex;
              }) || [];
            
            const nextLessonToGenerate = allLessons.find(l => !l.content || l.content === '');

            // A lesson in this module is being generated if the next lesson to generate is in this module
            const lessonId = nextLessonToGenerate ? `${id}-module-${nextLessonToGenerate.moduleIndex}-lesson-${nextLessonToGenerate.lessonIndex}` : '';
            const isGenerating = nextLessonToGenerate && this.courseService.isLessonBeingGenerated(lessonId);

            // Show module spinner only if the next lesson to generate is in this module AND generation is active
            showModuleSpinner = !!(nextLessonToGenerate && 
                                   nextLessonToGenerate.moduleIndex === moduleIndex && 
                                   isGenerating);
          }

          return `
        <div class="collapse collapse-plus bg-base-200 mb-2" data-module-index="${moduleIndex}">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${moduleCompletedIcon}${module.title}
            ${importanceBadge}
            ${showModuleSpinner ? '<span class="loading loading-spinner loading-sm ml-2"></span>' : ''}
          </div>
          <div class="collapse-content"> 
            ${
              hasLessons
                ? `
            <ul class="space-y-1">
              ${module.lessons
                .map((lesson: Lesson, lessonIndex: number) => {
                  const isCompleted = lesson.completedAt !== undefined;
                  const hasContent = lesson.content && lesson.content !== '';
                  const completedClass = isCompleted ? 'btn-success' : hasContent ? 'btn-primary' : 'btn-outline btn-secondary';
                  const completedIcon = isCompleted ? '<span class="mr-2">✓</span>' : '';
                  
                  // Only show spinner on lessons that are actually being generated
                  let loadingIcon = '';
                  const lessonId = `${id}-module-${moduleIndex}-lesson-${lessonIndex}`;
                  if (!hasContent && this.courseService.isLessonBeingGenerated(lessonId)) {
                    loadingIcon = '<span class="loading loading-spinner loading-xs ml-2"></span>';
                  }

                  return `
                <li class="mb-2">
                  <a href="/courses/lessons/${id}/${moduleIndex}/${lessonIndex}" class="btn ${completedClass} w-full justify-start text-left">
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

    res.json({ modulesHtml });
  }

  @Get('/:id')
  @UseGuards(AuthGuard)
  async getCoursePage(@Param('id') id: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithRelations(req.user.uid, id);

    if (!course) {
      return res.status(404).send('Course not found');
    }

    // Only generate lesson titles for modules that don't have them yet
    // Don't automatically start lesson content generation when just viewing the course
    this.courseService.generateRemainingLessonTitles(req.user.uid, id).catch((error) => {
      console.error('Course title generation failed:', error);
    });

    // Don't wait for generation to complete, but ensure it starts before rendering

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules
        .map((module: Module, moduleIndex: number) => {
          const importanceInfo = this.getConceptImportance(course, module.title);
          const importanceBadge = importanceInfo ? this.createImportanceBadge(importanceInfo.importance) : '';
          const hasLessons = module.lessons && module.lessons.length > 0;
          
          // Check if all lessons in this module are completed
          const allLessonsCompleted = hasLessons && module.lessons.every(lesson => 
            lesson.completedAt !== undefined
          );
          const moduleCompletedIcon = allLessonsCompleted ? '<span class="text-green-500 mr-2">✓</span>' : '';
          
          // Check if this module is actively generating lesson content
          let showModuleSpinner = false;
          if (hasLessons) {
            // Find the next lesson that should be generated globally
            const allLessons = course.modules
              ?.flatMap((m, mIndex) => (m.lessons || []).map((l, lIndex) => ({ ...l, moduleIndex: mIndex, lessonIndex: lIndex })))
              .sort((a, b) => {
                const moduleOrderDiff = a.moduleIndex - b.moduleIndex;
                if (moduleOrderDiff !== 0) return moduleOrderDiff;
                return a.lessonIndex - b.lessonIndex;
              }) || [];
            
            const nextLessonToGenerate = allLessons.find(l => !l.content || l.content === '');

            // A lesson in this module is being generated if the next lesson to generate is in this module
            const lessonId = nextLessonToGenerate ? `${id}-module-${nextLessonToGenerate.moduleIndex}-lesson-${nextLessonToGenerate.lessonIndex}` : '';
            const isGenerating = nextLessonToGenerate && this.courseService.isLessonBeingGenerated(lessonId);

            // Show module spinner only if the next lesson to generate is in this module AND generation is active
            showModuleSpinner = !!(nextLessonToGenerate && 
                                   nextLessonToGenerate.moduleIndex === moduleIndex && 
                                   isGenerating);
          }

          return `
        <div class="collapse collapse-plus bg-base-200 mb-2" data-module-index="${moduleIndex}">
          <input type="checkbox" /> 
          <div class="collapse-title text-xl font-medium">
            ${moduleCompletedIcon}${module.title}
            ${importanceBadge}
            ${showModuleSpinner ? '<span class="loading loading-spinner loading-sm ml-2"></span>' : ''}
          </div>
          <div class="collapse-content"> 
            ${
              hasLessons
                ? `
            <ul class="space-y-1">
              ${module.lessons
                .map((lesson: Lesson, lessonIndex: number) => {
                  const isCompleted = lesson.completedAt !== undefined;
                  const hasContent = lesson.content && lesson.content !== '';
                  const completedClass = isCompleted ? 'btn-success' : hasContent ? 'btn-primary' : 'btn-outline btn-secondary';
                  const completedIcon = isCompleted ? '<span class="mr-2">✓</span>' : '';
                  
                  // Only show spinner on lessons that are actually being generated
                  let loadingIcon = '';
                  const lessonId = `${id}-module-${moduleIndex}-lesson-${lessonIndex}`;
                  if (!hasContent && this.courseService.isLessonBeingGenerated(lessonId)) {
                    loadingIcon = '<span class="loading loading-spinner loading-xs ml-2"></span>';
                  }

                  return `
                <li class="mb-2">
                  <a href="/courses/lessons/${id}/${moduleIndex}/${lessonIndex}" class="btn ${completedClass} w-full justify-start text-left">
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

    debugLog('Debug - Course arxivId:', course.arxivId); // Debug log
    const html = TemplateHelper.renderTemplate('course-page.html', {
      paperTitle: course.paperTitle,
      arxivId: course.arxivId || 'unknown',
      modulesHtml: modulesHtml,
    });
    res.send(html);
  }

  @Get('/lessons/:courseId/:moduleIndex/:lessonIndex')
  @UseGuards(AuthGuard)
  async getLessonPage(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: string,
    @Param('lessonIndex') lessonIndex: string,
    @Res() res: Response,
    @Req() req: Request & { user: { uid: string } }
  ) {
    const moduleIdx = parseInt(moduleIndex, 10);
    const lessonIdx = parseInt(lessonIndex, 10);

    if (isNaN(moduleIdx) || isNaN(lessonIdx)) {
      return res.status(400).send('Invalid module or lesson index');
    }

    const lessonData = await this.courseService.findLessonById(req.user.uid, courseId, moduleIdx, lessonIdx);

    if (!lessonData) {
      return res.status(404).send('Lesson not found');
    }

    const { lesson, courseId: returnedCourseId } = lessonData;

    // Get the full course to determine navigation
    const course = await this.courseService.findCourseByIdWithRelations(req.user.uid, courseId);
    const navigation = course ? this.getLessonNavigation(course, moduleIdx, lessonIdx) : { previous: null, next: null };

    // Generate lesson content in these cases:
    // 1. This is the first lesson of the course and it has no content
    // 2. The next lesson doesn't have content yet
    const isFirstLesson = moduleIdx === 0 && lessonIdx === 0;
    const currentLessonNeedsContent = !lesson.content || lesson.content === '';
    const nextLessonNeedsContent = course && navigation.next && !navigation.next.hasContent;
    
    if (currentLessonNeedsContent && isFirstLesson) {
      debugLog(`User accessed first lesson ${courseId}/${moduleIdx}/${lessonIdx} (${lesson.title}) with no content, triggering generation`);
      
      setImmediate(() => {
        this.courseService.prepareNextLesson(req.user.uid, courseId).catch((error) => {
          console.error('Background lesson preparation failed:', error);
        });
      });
    } else if (nextLessonNeedsContent && navigation.next) {
      debugLog(`User accessed lesson ${courseId}/${moduleIdx}/${lessonIdx} (${lesson.title}), next lesson has no content, triggering background generation for specific next lesson`);
      
      setImmediate(() => {
        this.courseService.prepareSpecificLesson(
          req.user.uid, 
          courseId, 
          navigation.next.moduleIndex, 
          navigation.next.lessonIndex
        ).catch((error) => {
          console.error('Background specific lesson preparation failed:', error);
        });
      });
    } else if (course && !navigation.next) {
      // This is the last lesson - check if there are more modules to generate titles for
      this.courseService.generateRemainingLessonTitles(req.user.uid, courseId).catch((error) => {
        console.error('Background lesson title generation failed:', error);
      });
    }

    // Check if lesson has content
    if (!lesson.content || lesson.content === '') {
      debugLog(`User clicked on lesson ${courseId}/${moduleIdx}/${lessonIdx} (${lesson.title}) that needs content, triggering specific generation`);
      
      // Trigger generation of this specific lesson
      setImmediate(() => {
        this.courseService.prepareSpecificLesson(req.user.uid, courseId, moduleIdx, lessonIdx).catch((error) => {
          console.error('Specific lesson preparation failed:', error);
        });
      });

      const html = TemplateHelper.renderTemplate('lesson-loading.html', {
        lessonTitle: lesson.title,
        courseId: courseId,
        lessonId: `${courseId}-module-${moduleIdx}-lesson-${lessonIdx}`,
      });
      return res.send(html);
    }

    // Convert markdown to HTML
    let lessonContentHtml = marked(lesson.content);

    // Post-process to convert mathematical notation from code tags to LaTeX
    lessonContentHtml = this.convertMathCodeToLatex(lessonContentHtml);

    // Generate navigation HTML
    const previousLessonHtml = navigation.previous ? 
      `<a href="/courses/lessons/${courseId}/${navigation.previous.moduleIndex}/${navigation.previous.lessonIndex}" 
         class="btn btn-outline btn-primary lesson-nav-btn${!navigation.previous.hasContent ? ' btn-disabled' : ''}"
         title="${navigation.previous.title}">
         <span class="mr-2">←</span> Previous Lesson
       </a>` : '';

    const nextLessonHtml = navigation.next ? 
      `<a href="/courses/lessons/${courseId}/${navigation.next.moduleIndex}/${navigation.next.lessonIndex}" 
         class="btn btn-outline btn-primary lesson-nav-btn"
         title="${navigation.next.title}">
         Next Lesson <span class="ml-2">→</span>
       </a>` : '';

    const html = TemplateHelper.renderTemplate('lesson-page.html', {
      lessonTitle: lesson.title,
      lessonContent: lessonContentHtml,
      courseId: courseId,
      lessonId: `${courseId}-${moduleIdx}-${lessonIdx}`,
      previousLessonHtml: previousLessonHtml,
      nextLessonHtml: nextLessonHtml,
    });
    res.send(html);
  }

  @Post('/lessons/:courseId/:moduleIndex/:lessonIndex/complete')
  @UseGuards(AuthGuard)
  async markLessonComplete(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: string,
    @Param('lessonIndex') lessonIndex: string,
    @Res() res: Response,
    @Req() req: Request & { user: { uid: string } }
  ) {
    try {
      const moduleIdx = parseInt(moduleIndex, 10);
      const lessonIdx = parseInt(lessonIndex, 10);

      if (isNaN(moduleIdx) || isNaN(lessonIdx)) {
        return res.status(400).send('Invalid module or lesson index');
      }

      await this.courseService.markLessonComplete(req.user.uid, courseId, moduleIdx, lessonIdx);

      // Get course navigation to check if next lesson needs content
      const course = await this.courseService.findCourseByIdWithRelations(req.user.uid, courseId);
      const navigation = course ? this.getLessonNavigation(course, moduleIdx, lessonIdx) : { previous: null, next: null };
      
      // Only trigger generation if the next lesson doesn't have content yet
      if (course && navigation.next && !navigation.next.hasContent) {
        debugLog(`User completed lesson ${courseId}/${moduleIdx}/${lessonIdx}, next lesson has no content, triggering background generation`);
        
        setImmediate(() => {
          this.courseService.prepareNextLesson(req.user.uid, courseId).catch((error) => {
            console.error('Background lesson preparation after completion failed:', error);
          });
        });
      } else if (course && !navigation.next) {
        // This was the last lesson - check if there are more modules to generate titles for
        this.courseService.generateRemainingLessonTitles(req.user.uid, courseId).catch((error) => {
          console.error('Background lesson title generation after completion failed:', error);
        });
      }
      
      res.redirect(`/courses/${courseId}`);
    } catch (error) {
      console.error('Error marking lesson complete:', error);
      res.status(500).send('Error marking lesson complete');
    }
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async deleteCourse(@Param('id') id: string, @Res() res: Response, @Req() req: Request & { user: { uid: string } }) {
    debugLog(`DELETE request received for course ID: ${id}`);
    
    try {
      await this.courseService.deleteCourse(req.user.uid, id);
      debugLog(`Successfully deleted course ${id}`);
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