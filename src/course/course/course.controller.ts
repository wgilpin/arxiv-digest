import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { CourseService } from './course.service';
import { Course } from '../../database/entities/course.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Module } from '../../database/entities/module.entity';

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
                <li><a href="/lessons/${lesson.id}" class="link link-primary">${lesson.title}</a></li>
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

    res.send(`
      <![CDATA[<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Course: ${course.paperTitle}</title>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
      </head>
      <body>
        <div class="container mx-auto p-4">
          <h1 class="text-3xl font-bold mb-6 text-center">Course: ${course.paperTitle}</h1>
          <div class="space-y-4">
            ${modulesHtml}
          </div>
        </div>
      </body>
      </html>]]>
    `);
  }

  @Get('/lessons/:id')
  async getLessonPage(@Param('id') id: number, @Res() res: Response) {
    const lesson: Lesson | null = await this.courseService.findLessonById(id);

    if (!lesson) {
      return res.status(404).send('Lesson not found');
    }

    res.send(`
      <![CDATA[<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${lesson.title}</title>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
      </head>
      <body>
        <div class="container mx-auto p-4">
          <h1 class="text-3xl font-bold mb-4">${lesson.title}</h1>
          <div class="card bg-base-100 shadow-xl p-8 mb-4">
            <p class="prose">${lesson.content}</p>
          </div>
          <a href="/courses/${lesson.module.course.id}" class="btn btn-primary">Back to Course</a>
        </div>
      </body>
      </html>]]>
    `);
  }
}
