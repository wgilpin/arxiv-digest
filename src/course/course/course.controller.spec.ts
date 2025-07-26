import { Test, TestingModule } from '@nestjs/testing';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { Response } from 'express';
import { Course } from '../../database/entities/course.entity';
import { Module } from '../../database/entities/module.entity';
import { Lesson } from '../../database/entities/lesson.entity';

describe('CourseController', () => {
  let controller: CourseController;
  let courseService: CourseService;
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseController],
      providers: [
        {
          provide: CourseService,
          useValue: {
            findCourseByIdWithRelations: jest.fn(),
            findLessonById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CourseController>(CourseController);
    courseService = module.get<CourseService>(CourseService);

    mockResponse = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('Golden Path - Course Viewing Flow', () => {
    it('should display course page with modules and lessons', async () => {
      // Arrange
      const courseId = 1;
      const mockLesson1 = {
        id: 1,
        title: 'Introduction to Transformers',
        content: 'Basic concepts...',
        orderIndex: 1,
      } as Lesson;

      const mockLesson2 = {
        id: 2,
        title: 'Self-Attention Mechanism',
        content: 'Detailed explanation...',
        orderIndex: 2,
      } as Lesson;

      const mockModule1 = {
        id: 1,
        title: 'Transformer Basics',
        orderIndex: 1,
        lessons: [mockLesson1, mockLesson2],
      } as Module;

      const mockCourse = {
        id: courseId,
        paperTitle: 'Attention Is All You Need',
        paperArxivId: '2017.1234',
        comprehensionLevel: 'beginner',
        modules: [mockModule1],
      } as Course;

      jest
        .spyOn(courseService, 'findCourseByIdWithRelations')
        .mockResolvedValue(mockCourse);

      // Act
      await controller.getCoursePage(courseId, mockResponse as Response);

      // Assert
      expect(courseService.findCourseByIdWithRelations).toHaveBeenCalledWith(
        courseId,
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Course: Attention Is All You Need'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Transformer Basics'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Introduction to Transformers'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Self-Attention Mechanism'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('/lessons/1'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('/lessons/2'),
      );
    });

    it('should handle course with no modules', async () => {
      // Arrange
      const courseId = 1;
      const mockCourse = {
        id: courseId,
        paperTitle: 'Test Paper',
        paperArxivId: '2017.5678',
        comprehensionLevel: 'beginner',
        extractedConcepts: [],
        createdAt: new Date(),
        modules: [],
      } as Course;

      jest
        .spyOn(courseService, 'findCourseByIdWithRelations')
        .mockResolvedValue(mockCourse);

      // Act
      await controller.getCoursePage(courseId, mockResponse as Response);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('No modules found for this course'),
      );
    });

    it('should return 404 for non-existent course', async () => {
      // Arrange
      const courseId = 999;
      jest
        .spyOn(courseService, 'findCourseByIdWithRelations')
        .mockResolvedValue(null);

      // Act
      await controller.getCoursePage(courseId, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith('Course not found');
    });
  });

  describe('Golden Path - Lesson Viewing Flow', () => {
    it('should display lesson page with content and back link', async () => {
      // Arrange
      const lessonId = 1;
      const mockLesson = {
        id: lessonId,
        title: 'Introduction to Transformers',
        content:
          'The Transformer is a novel architecture that relies entirely on attention mechanisms...',
        orderIndex: 1,
        module: {
          id: 1,
          title: 'Transformer Basics',
          course: {
            id: 1,
            paperTitle: 'Attention Is All You Need',
          },
        },
      } as Lesson;

      jest.spyOn(courseService, 'findLessonById').mockResolvedValue(mockLesson);

      // Act
      await controller.getLessonPage(lessonId, mockResponse as Response);

      // Assert
      expect(courseService.findLessonById).toHaveBeenCalledWith(lessonId);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Introduction to Transformers'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('The Transformer is a novel architecture'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('/courses/1'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Back to Course'),
      );
    });

    it('should return 404 for non-existent lesson', async () => {
      // Arrange
      const lessonId = 999;
      jest.spyOn(courseService, 'findLessonById').mockResolvedValue(null);

      // Act
      await controller.getLessonPage(lessonId, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith('Lesson not found');
    });
  });
});
