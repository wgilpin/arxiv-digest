import { Test, TestingModule } from '@nestjs/testing';
import { CourseService } from './course.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Course } from '../../database/entities/course.entity';
import { Module as CourseModuleEntity } from '../../database/entities/module.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Progress } from '../../database/entities/progress.entity';
import { GenerationService } from '../../generation/generation/generation.service';
import { Repository } from 'typeorm';

describe('CourseService - Phase 4 Progress Tracking', () => {
  let service: CourseService;
  let progressRepository: Repository<Progress>;
  let courseRepository: Repository<Course>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        {
          provide: getRepositoryToken(Course),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CourseModuleEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Lesson),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Progress),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: GenerationService,
          useValue: {
            generateLessonContent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    progressRepository = module.get<Repository<Progress>>(
      getRepositoryToken(Progress),
    );
    courseRepository = module.get<Repository<Course>>(
      getRepositoryToken(Course),
    );
  });

  describe('Progress Tracking', () => {
    it('should mark lesson as complete when no existing progress', async () => {
      const lessonId = 1;
      const mockProgress = { lessonId, readAt: new Date() } as Progress;

      jest.spyOn(progressRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(progressRepository, 'create').mockReturnValue(mockProgress);
      jest.spyOn(progressRepository, 'save').mockResolvedValue(mockProgress);

      await service.markLessonComplete(lessonId);

      expect(progressRepository.findOne).toHaveBeenCalledWith({
        where: { lessonId },
      });
      expect(progressRepository.create).toHaveBeenCalledWith({
        lessonId,
        readAt: expect.any(Date) as Date,
      });
      expect(progressRepository.save).toHaveBeenCalledWith(mockProgress);
    });

    it('should not create duplicate progress for already completed lesson', async () => {
      const lessonId = 1;
      const existingProgress = {
        id: 1,
        lessonId,
        readAt: new Date(),
      } as Progress;

      jest
        .spyOn(progressRepository, 'findOne')
        .mockResolvedValue(existingProgress);
      jest.spyOn(progressRepository, 'create');
      jest.spyOn(progressRepository, 'save');

      await service.markLessonComplete(lessonId);

      expect(progressRepository.findOne).toHaveBeenCalledWith({
        where: { lessonId },
      });
      expect(progressRepository.create).not.toHaveBeenCalled();
      expect(progressRepository.save).not.toHaveBeenCalled();
    });

    it('should find course with progress information', async () => {
      const courseId = 1;
      const mockCourse = {
        id: courseId,
        paperTitle: 'Test Paper',
        modules: [
          {
            id: 1,
            title: 'Module 1',
            lessons: [
              {
                id: 1,
                title: 'Lesson 1',
                progress: [{ id: 1, readAt: new Date() }],
              },
              { id: 2, title: 'Lesson 2', progress: [] },
            ],
          },
        ],
      } as Course;

      jest.spyOn(courseRepository, 'findOne').mockResolvedValue(mockCourse);

      const result = await service.findCourseByIdWithProgress(courseId);

      expect(courseRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
        relations: ['modules', 'modules.lessons', 'modules.lessons.progress'],
      });
      expect(result).toEqual(mockCourse);
    });
  });
});
