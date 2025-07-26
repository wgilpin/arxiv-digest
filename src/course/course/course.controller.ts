import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CourseService } from './course.service';
import { Course } from '../../database/entities/course.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Module } from '../../database/entities/module.entity';
import { TemplateHelper } from '../../templates/template-helper';

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  @Get('/:id')
  async getCoursePage(@Param('id') id: number, @Res() res: Response) {
    const course: Course | null =
      await this.courseService.findCourseByIdWithRelations(id);

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
                .map(
                  (lesson: Lesson) => `
                <li><a href="/courses/lessons/${lesson.id}" class="link link-primary">${lesson.title}</a></li>
              `,
                )
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

    const html = TemplateHelper.renderTemplate('lesson-page.html', {
      lessonTitle: lesson.title,
      lessonContent: lesson.content,
      courseId: lesson.module.course.id,
    });
    res.send(html);
  }
}
