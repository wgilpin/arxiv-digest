import { Test, TestingModule } from '@nestjs/testing';
import { PaperController } from './paper.controller';
import { ArxivService } from '../arxiv/arxiv.service';
import { GenerationService } from '../generation/generation/generation.service';
import { CourseService } from '../course/course/course.service';
import { CourseRepository } from '../data/repositories/course.repository';
import { AuthService } from '../auth/auth.service';
import { Response } from 'express';

describe('PaperController', () => {
  let controller: PaperController;
  let courseRepository: jest.Mocked<CourseRepository>;
  let mockResponse: jest.Mocked<Response>;

  beforeEach(async () => {
    const mockCourseRepository = {
      findAll: jest.fn(),
      createCourse: jest.fn(),
      findCourseById: jest.fn(),
      updateCourse: jest.fn(),
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
            createCourseFromPaper: jest.fn(),
            generateSyllabus: jest.fn(),
            findAllCourses: jest.fn().mockResolvedValue([]),
            calculateMultipleCoursesCosts: jest.fn().mockResolvedValue({}),
            deleteCourse: jest.fn(),
          },
        },
        {
          provide: CourseRepository,
          useValue: mockCourseRepository,
        },
        {
          provide: AuthService,
          useValue: {
            verifyIdToken: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PaperController>(PaperController);
    courseRepository = module.get(CourseRepository);

    mockResponse = {
      send: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    } as any;
  });

  describe('Dashboard Date Formatting', () => {
    it('should handle Date objects correctly', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: '1',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: new Date('2023-01-01T10:00:00Z'),
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(courseRepository.findAll).toHaveBeenCalledWith('user123');
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('01/01/2023')
      );
    });

    it('should handle string dates correctly', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: '1',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: '2023-01-01T10:00:00Z', // String date
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('01/01/2023')
      );
    });

    it('should handle Firestore Timestamps correctly', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: '1',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: { 
            toDate: () => new Date('2023-01-01T10:00:00Z') 
          }, // Firestore Timestamp-like object
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('01/01/2023')
      );
    });

    it('should handle invalid dates gracefully', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: '1',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: 'invalid-date-string',
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid date')
      );
    });

    it('should handle null/undefined dates gracefully', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: '1',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: null,
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Unknown date')
      );
    });

    it('should handle empty course list', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses: any[] = [];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(courseRepository.findAll).toHaveBeenCalledWith('user123');
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('No courses yet')
      );
    });
  });

  describe('formatDate helper method', () => {
    it('should be accessible for testing', () => {
      // Test the private method via type assertion
      const formatDate = (controller as any).formatDate;
      
      expect(formatDate(new Date('2023-01-01'))).toBe('01/01/2023');
      expect(formatDate('2023-01-01')).toBe('01/01/2023');
      expect(formatDate({ toDate: () => new Date('2023-01-01') })).toBe('01/01/2023');
      expect(formatDate('invalid')).toBe('Invalid date');
      expect(formatDate(null)).toBe('Unknown date');
      expect(formatDate(undefined)).toBe('Unknown date');
    });
  });

  describe('escapeJavaScript helper method', () => {
    it('should properly escape JavaScript strings', () => {
      const escapeJavaScript = (controller as any).escapeJavaScript;
      
      expect(escapeJavaScript('simple')).toBe('simple');
      expect(escapeJavaScript("test'quote")).toBe("test\\'quote");
      expect(escapeJavaScript('test"double')).toBe('test\\"double');
      expect(escapeJavaScript('test\\backslash')).toBe('test\\\\backslash');
      expect(escapeJavaScript(null)).toBe('');
      expect(escapeJavaScript(undefined)).toBe('');
      expect(escapeJavaScript(123)).toBe('123');
    });
  });

  describe('delete button generation', () => {
    it('should generate proper delete button with normal course ID', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: 'normal-course-id',
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: new Date('2023-01-01T10:00:00Z'),
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining("confirmDelete('normal-course-id')")
      );
    });

    it('should generate proper delete button with escaped course ID', async () => {
      // Arrange
      const mockRequest = { user: { uid: 'user123' } };
      const mockCourses = [
        {
          id: "course'with\"quotes",
          paperTitle: 'Test Paper',
          arxivId: '2017.1234',
          createdAt: new Date('2023-01-01T10:00:00Z'),
        },
      ];

      courseRepository.findAll.mockResolvedValue(mockCourses as any);

      // Act
      await controller.getDashboard(mockResponse, mockRequest as any);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining("confirmDelete('course\\'with\\\"quotes')")
      );
    });
  });
});