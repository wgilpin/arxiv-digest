import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CourseService } from './course.service';
import { Course } from '../../database/entities/course.entity';
import { Lesson } from '../../database/entities/lesson.entity';

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
          (module) => `
        <h2>${module.title}</h2>
        <ul>
          ${module.lessons
            .map(
              (lesson) => `
            <li><a href="/lessons/${lesson.id}">${lesson.title}</a></li>
          `,
            )
            .join('')}
        </ul>
      `,
        )
        .join('');
    } else {
      modulesHtml = '<p>No modules found for this course.</p>';
    }

    res.send(`
      <h1>Course: ${course.paperTitle}</h1>
      ${modulesHtml}
    `);
  }

  @Get('/lessons/:id')
  async getLessonPage(@Param('id') id: number, @Res() res: Response) {
    const lesson: Lesson | null = await this.courseService.findLessonById(id);

    if (!lesson) {
      return res.status(404).send('Lesson not found');
    }

    res.send(`
      <h1>${lesson.title}</h1>
      <p>${lesson.content}</p>
      <a href="/courses/${lesson.module.course.id}">Back to Course</a>
    `);
  }
}
