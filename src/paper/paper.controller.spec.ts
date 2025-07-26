import { Test, TestingModule } from '@nestjs/testing';
import { PaperController } from './paper.controller';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { CourseService } from '../course/course/course.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Course } from '../database/entities/course.entity';
import { Repository } from 'typeorm';
import { Response } from 'express';

describe('PaperController', () => {
  let controller: PaperController;
  let arxivService: ArxivService;
  let generationService: GenerationService;
  let courseService: CourseService;
  let courseRepository: Repository<Course>;
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    const mockCourseRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOneBy: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaperController],
      providers: [
        {
          provide: ArxivService,
          useValue: {
            fetchPaperTitle: jest.fn(),
            getPaperText: jest.fn(),
          },
        },
        {
          provide: GenerationService,
          useValue: {
            extractConcepts: jest.fn(),
          },
        },
        {
          provide: CourseService,
          useValue: {
            generateSyllabus: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Course),
          useValue: mockCourseRepository,
        },
      ],
    }).compile();

    controller = module.get<PaperController>(PaperController);
    arxivService = module.get<ArxivService>(ArxivService);
    generationService = module.get<GenerationService>(GenerationService);
    courseService = module.get<CourseService>(CourseService);
    courseRepository = module.get<Repository<Course>>(
      getRepositoryToken(Course),
    );

    mockResponse = {
      send: jest.fn(),
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('Golden Path - Paper Submission Flow', () => {
    it('should successfully create course from ArXiv paper submission', async () => {
      // Arrange
      const arxivId = '2017.1234';
      const mockPaper = {
        title: 'Attention Is All You Need',
        text: 'This paper introduces the Transformer...',
        concepts: ['Transformers', 'Self-Attention', 'Positional Encoding'],
      };
      const mockCourse = {
        id: 1,
        paperArxivId: arxivId,
        paperTitle: mockPaper.title,
        comprehensionLevel: 'beginner',
        extractedConcepts: mockPaper.concepts,
      };

      jest
        .spyOn(arxivService, 'fetchPaperTitle')
        .mockResolvedValue(mockPaper.title);
      jest
        .spyOn(arxivService, 'getPaperText')
        .mockResolvedValue(mockPaper.text);
      jest
        .spyOn(generationService, 'extractConcepts')
        .mockResolvedValue(mockPaper.concepts);
      jest
        .spyOn(courseRepository, 'create')
        .mockReturnValue(mockCourse as Course);
      jest
        .spyOn(courseRepository, 'save')
        .mockResolvedValue(mockCourse as Course);

      // Act
      await controller.createCourse(arxivId, mockResponse as Response);

      // Assert
      expect(arxivService.fetchPaperTitle).toHaveBeenCalledWith(arxivId);
      expect(arxivService.getPaperText).toHaveBeenCalledWith(arxivId);
      expect(generationService.extractConcepts).toHaveBeenCalledWith(
        mockPaper.text,
      );
      expect(courseRepository.create).toHaveBeenCalledWith({
        paperArxivId: arxivId,
        paperTitle: mockPaper.title,
        comprehensionLevel: 'beginner',
        extractedConcepts: mockPaper.concepts,
      });
      expect(courseRepository.save).toHaveBeenCalledWith(mockCourse);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/1/assess');
    });

    it('should display assessment page with extracted concepts', async () => {
      // Arrange
      const courseId = 1;
      const mockCourse = {
        id: courseId,
        paperTitle: 'Attention Is All You Need',
        extractedConcepts: [
          'Transformers',
          'Self-Attention',
          'Positional Encoding',
        ],
      };

      jest
        .spyOn(courseRepository, 'findOneBy')
        .mockResolvedValue(mockCourse as Course);

      // Act
      await controller.getAssessmentPage(courseId, mockResponse as Response);

      // Assert
      expect(courseRepository.findOneBy).toHaveBeenCalledWith({ id: courseId });
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining(
          'Assess Concepts for: Attention Is All You Need',
        ),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Transformers'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Self-Attention'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Positional Encoding'),
      );
    });

    it('should process assessment and generate syllabus', async () => {
      // Arrange
      const courseId = 1;
      const assessmentBody = {
        'rating-Transformers': '2',
        'rating-Self-Attention': '1',
        'rating-Positional Encoding': '3',
      };
      const expectedRatings = {
        Transformers: 2,
        'Self-Attention': 1,
        'Positional Encoding': 3,
      };

      jest
        .spyOn(courseService, 'generateSyllabus')
        .mockResolvedValue(undefined);

      // Act
      await controller.submitAssessment(
        courseId,
        assessmentBody,
        mockResponse as Response,
      );

      // Assert
      expect(courseService.generateSyllabus).toHaveBeenCalledWith(
        courseId,
        expectedRatings,
      );
      expect(mockResponse.redirect).toHaveBeenCalledWith('/courses/1');
    });
  });

  describe('Dashboard Rendering', () => {
    it('should render dashboard with course list', async () => {
      // Arrange
      const mockCourses = [
        {
          id: 1,
          paperTitle: 'Test Paper',
          paperArxivId: '2017.1234',
          createdAt: new Date('2023-01-01'),
        },
      ];

      jest
        .spyOn(courseRepository, 'find')
        .mockResolvedValue(mockCourses as Course[]);

      // Act
      await controller.getDashboard(mockResponse as Response);

      // Assert
      expect(courseRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('ArXiv Learning Tool - Dashboard'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Test Paper'),
      );
    });
  });
});
