 
 
 
 
 
 
import { Test, TestingModule } from '@nestjs/testing';
import { CourseService } from './course.service';
import { CourseRepository } from '../../data/repositories/course.repository';
import { ModelCostRepository } from '../../data/repositories/model-cost.repository';
import { GenerationService } from '../../generation/generation/generation.service';
import { CourseGateway } from './course.gateway';
import { Course, Module, Lesson } from '../../firestore/interfaces/firestore.interfaces';

describe('CourseService', () => {
  let service: CourseService;
  let courseRepository: jest.Mocked<CourseRepository>;
  let modelCostRepository: jest.Mocked<ModelCostRepository>;
  let generationService: jest.Mocked<GenerationService>;
  let courseGateway: jest.Mocked<CourseGateway>;

  beforeEach(async () => {
    const mockCourseRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      updateModule: jest.fn(),
      updateLesson: jest.fn(),
      findLessonByPath: jest.fn(),
      markLessonComplete: jest.fn(),
      delete: jest.fn(),
    };

    const mockModelCostRepository = {
      getModelCostMap: jest.fn(),
    };

    const mockGenerationService = {
      generateLessonTopics: jest.fn(),
      generateLessonFromExternalSources: jest.fn(),
      generateSummaryLesson: jest.fn(),
      getAndResetTokenUsage: jest.fn(),
    };

    const mockCourseGateway = {
      emitLessonTitlesGenerated: jest.fn(),
      emitGenerationStarted: jest.fn(),
      emitLessonContentGenerated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        {
          provide: CourseRepository,
          useValue: mockCourseRepository,
        },
        {
          provide: ModelCostRepository,
          useValue: mockModelCostRepository,
        },
        {
          provide: GenerationService,
          useValue: mockGenerationService,
        },
        {
          provide: CourseGateway,
          useValue: mockCourseGateway,
        },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    courseRepository = module.get(CourseRepository);
    modelCostRepository = module.get(ModelCostRepository);
    generationService = module.get(GenerationService);
    courseGateway = module.get(CourseGateway);
  });

  describe('Course Management', () => {
    it('should mark lesson as complete', async () => {
      const userId = 'test-user';
      const courseId = 'test-course';
      const moduleIndex = 0;
      const lessonIndex = 0;

      courseRepository.markLessonComplete.mockResolvedValue();

      await service.markLessonComplete(userId, courseId, moduleIndex, lessonIndex);

      expect(courseRepository.markLessonComplete).toHaveBeenCalledWith(
        userId,
        courseId,
        moduleIndex,
        lessonIndex,
      );
    });

    it('should find course by id with relations', async () => {
      const userId = 'test-user';
      const courseId = 'test-course';
      const mockCourse: Course = {
        id: courseId,
        title: 'Test Course',
        description: 'Test course description',
        paperTitle: 'Test Paper',
        paperAuthors: ['Test Author'],
        paperUrl: 'https://arxiv.org/abs/1234.5678',
        arxivId: '1234.5678',
        createdAt: new Date(),
        updatedAt: new Date(),
        modules: [
          {
            title: 'Module 1',
            description: 'Test module',
            lessons: [
              {
                title: 'Lesson 1',
                content: 'Test content',
              },
            ],
          },
        ],
      };

      courseRepository.findById.mockResolvedValue(mockCourse);

      const result = await service.findCourseByIdWithRelations(userId, courseId);

      expect(courseRepository.findById).toHaveBeenCalledWith(userId, courseId);
      expect(result).toEqual(mockCourse);
    });

    it('should find all courses for user', async () => {
      const userId = 'test-user';
      const mockCourses: Course[] = [
        {
          id: 'course1',
          title: 'Course 1',
          description: 'Course 1 description',
          paperTitle: 'Paper 1',
          paperAuthors: ['Author 1'],
          paperUrl: 'https://arxiv.org/abs/1111.1111',
          arxivId: '1111.1111',
          createdAt: new Date(),
          updatedAt: new Date(),
          modules: [],
        },
        {
          id: 'course2',
          title: 'Course 2',
          description: 'Course 2 description',
          paperTitle: 'Paper 2',
          paperAuthors: ['Author 2'],
          paperUrl: 'https://arxiv.org/abs/2222.2222',
          arxivId: '2222.2222',
          createdAt: new Date(),
          updatedAt: new Date(),
          modules: [],
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses);

      const result = await service.findAllCourses(userId);

      expect(courseRepository.findAll).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockCourses);
    });
  });
});
