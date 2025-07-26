import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Module as CourseModuleEntity } from '../../database/entities/module.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Progress } from '../../database/entities/progress.entity';
import { GenerationService } from '../../generation/generation/generation.service';

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course)
    private courseRepository: Repository<Course>,
    @InjectRepository(CourseModuleEntity)
    private moduleRepository: Repository<CourseModuleEntity>,
    @InjectRepository(Lesson)
    private lessonRepository: Repository<Lesson>,
    @InjectRepository(Progress)
    private progressRepository: Repository<Progress>,
    private generationService: GenerationService,
  ) {}

  async generateSyllabus(
    courseId: number,
    ratings: Record<string, number>,
  ): Promise<void> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
    });
    if (!course) {
      throw new Error(`Course with ID ${courseId} not found.`);
    }

    const knowledgeGaps = Object.entries(ratings)
      .filter(([, rating]) => rating <= 3)
      .map(([concept]) => concept);

    let moduleOrderIndex = 0;
    for (const concept of knowledgeGaps) {
      const newModule = this.moduleRepository.create({
        title: concept,
        orderIndex: moduleOrderIndex++,
        course: course,
      });
      await this.moduleRepository.save(newModule);

      const lessonContent =
        await this.generationService.generateLessonContent(concept);

      const newLesson = this.lessonRepository.create({
        title: lessonContent.title,
        content: lessonContent.content,
        orderIndex: 0, // Assuming one lesson per module for now
        module: newModule,
      });
      await this.lessonRepository.save(newLesson);
    }
  }

  async findCourseByIdWithRelations(id: number): Promise<Course | null> {
    return this.courseRepository.findOne({
      where: { id },
      relations: ['modules', 'modules.lessons'],
    });
  }

  async findLessonById(id: number): Promise<Lesson | null> {
    return this.lessonRepository.findOne({
      where: { id },
      relations: ['module', 'module.course'],
    });
  }

  async markLessonComplete(lessonId: number): Promise<void> {
    // Check if progress already exists for this lesson
    const existingProgress = await this.progressRepository.findOne({
      where: { lessonId },
    });

    if (!existingProgress) {
      const progress = this.progressRepository.create({
        lessonId,
        readAt: new Date(),
      });
      await this.progressRepository.save(progress);
    }
  }

  async findCourseByIdWithProgress(id: number): Promise<Course | null> {
    return this.courseRepository.findOne({
      where: { id },
      relations: ['modules', 'modules.lessons', 'modules.lessons.progress'],
    });
  }
}
