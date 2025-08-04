import { Test, TestingModule } from '@nestjs/testing';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { AuthService } from '../../auth/auth.service';
import { Response } from 'express';
import { Course, Module, Lesson } from '../../firestore/interfaces/firestore.interfaces';

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
            findCourseByIdWithProgress: jest.fn(),
            findLessonById: jest.fn(),
            markLessonComplete: jest.fn(),
            prepareSpecificLesson: jest.fn(),
            generateRemainingLessonTitles: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthService,
          useValue: {
            verifyIdToken: jest.fn(),
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
        title: 'Transformer Basics',
        description: 'Transformer basics module',
        lessons: [mockLesson1, mockLesson2],
      } as Module;

      const mockCourse = {
        id: courseId.toString(),
        title: 'Test Course',
        description: 'Test course description',
        paperTitle: 'Attention Is All You Need',
        paperAuthors: ['Ashish Vaswani'],
        paperUrl: 'https://arxiv.org/abs/2017.1234',
        arxivId: '2017.1234',
        createdAt: new Date(),
        updatedAt: new Date(),
        modules: [mockModule1],
      } as Course;

      jest
        .spyOn(courseService, 'findCourseByIdWithRelations')
        .mockResolvedValue(mockCourse);

      // Act
      const mockRequest = { user: { uid: 'test-user-id' } } as any;
      await controller.getCoursePage(courseId.toString(), mockResponse as Response, mockRequest);

      // Assert
      expect(courseService.findCourseByIdWithRelations).toHaveBeenCalledWith(
        'test-user-id',
        courseId.toString(),
      );
      expect(mockResponse.send).toHaveBeenCalledTimes(1);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Attention Is All You Need'),
      );
    });

    it('should handle course with no modules', async () => {
      // Arrange
      const courseId = 1;
      const mockCourse = {
        id: courseId.toString(),
        title: 'Test Course',
        description: 'Test course description',
        paperTitle: 'Test Paper',
        paperAuthors: ['Test Author'],
        paperUrl: 'https://arxiv.org/abs/2017.5678',
        arxivId: '2017.5678',
        createdAt: new Date(),
        updatedAt: new Date(),
        extractedConcepts: [],
        modules: [],
      } as Course;

      jest
        .spyOn(courseService, 'findCourseByIdWithRelations')
        .mockResolvedValue(mockCourse);

      // Act
      const mockRequest = { user: { uid: 'test-user-id' } } as any;
      await controller.getCoursePage(courseId.toString(), mockResponse as Response, mockRequest);

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
      const mockRequest = { user: { uid: 'test-user-id' } } as any;
      await controller.getCoursePage(courseId.toString(), mockResponse as Response, mockRequest);

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

      jest.spyOn(courseService, 'findLessonById').mockResolvedValue({
        lesson: mockLesson,
        module: { title: 'Test Module', description: 'Test module description', lessons: [] },
        courseId: 'test-course-id'
      });

      // Act
      const mockRequest = { user: { uid: 'test-user-id' } } as any;
      await controller.getLessonPage('test-course-id', '0', '0', mockResponse as Response, mockRequest);

      // Assert
      expect(courseService.findLessonById).toHaveBeenCalledWith('test-user-id', 'test-course-id', 0, 0);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Introduction to Transformers'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('The Transformer is a novel architecture'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('/courses/test-course-id'),
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
      const mockRequest = { user: { uid: 'test-user-id' } } as any;
      await controller.getLessonPage('test-course-id', '0', '0', mockResponse as Response, mockRequest);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith('Lesson not found');
    });
  });
});
