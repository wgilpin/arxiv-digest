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

    // Store all concepts for future generation
    course.plannedConcepts = knowledgeGaps.join(',');
    await this.courseRepository.save(course);

    // First, create all module placeholders so users can see the full course structure
    const modulePromises = knowledgeGaps.map(async (concept, index) => {
      const newModule = this.moduleRepository.create({
        title: concept,
        orderIndex: index,
        course: course,
      });
      return await this.moduleRepository.save(newModule);
    });

    await Promise.all(modulePromises);

    // Then generate actual content only for the first module
    if (knowledgeGaps.length > 0) {
      await this.generateModuleContent(course, knowledgeGaps[0], 0);
    }
  }

  /**
   * Generates actual lesson content for a module (assumes module placeholder already exists)
   */
  async generateModuleContent(course: Course, concept: string, orderIndex: number): Promise<CourseModuleEntity> {
    console.log(`Starting generateModuleContent for course ${course.id}, concept: ${concept}, orderIndex: ${orderIndex}`);
    
    // Find the existing module placeholder
    const existingModule = await this.moduleRepository.findOne({
      where: { course: { id: course.id }, orderIndex },
      relations: ['lessons'],
    });

    if (!existingModule) {
      console.error(`Module placeholder not found for order index ${orderIndex}`);
      throw new Error(`Module placeholder not found for order index ${orderIndex}`);
    }

    console.log(`Found module ${existingModule.id}, current lesson count: ${existingModule.lessons?.length || 0}`);

    // Check if module already has content
    if (existingModule.lessons && existingModule.lessons.length > 0) {
      console.log(`Module ${existingModule.id} already has content, skipping generation`);
      return existingModule; // Module content already generated
    }

    // Generate lesson topics for this concept
    console.log(`Generating lesson topics for concept: ${concept}`);
    const lessonTopics = await this.generationService.generateLessonTopics(concept);
    console.log(`Generated ${lessonTopics.length} lesson topics:`, lessonTopics);

    // Create multiple lessons for this module
    let lessonOrderIndex = 0;
    for (const topic of lessonTopics) {
      console.log(`Generating lesson ${lessonOrderIndex + 1}: ${topic}`);
      const lessonContent = await this.generationService.generateLessonContent(concept, topic);

      const newLesson = this.lessonRepository.create({
        title: lessonContent.title,
        content: lessonContent.content,
        orderIndex: lessonOrderIndex++,
        module: existingModule,
      });
      const savedLesson = await this.lessonRepository.save(newLesson);
      console.log(`Saved lesson ${savedLesson.id}: ${savedLesson.title}`);
    }

    // Reload the module with lessons to ensure they're attached
    const updatedModule = await this.moduleRepository.findOne({
      where: { id: existingModule.id },
      relations: ['lessons'],
    });

    console.log(`Module generation complete. Final lesson count: ${updatedModule?.lessons?.length || 0}`);
    return updatedModule || existingModule;
  }

  /**
   * Generates a single module with its lessons (for backward compatibility and on-demand generation)
   */
  async generateModule(course: Course, concept: string, orderIndex: number): Promise<CourseModuleEntity> {
    // Check if module already exists with content
    const existingModule = await this.moduleRepository.findOne({
      where: { course: { id: course.id }, orderIndex },
      relations: ['lessons'],
    });

    if (existingModule && existingModule.lessons && existingModule.lessons.length > 0) {
      return existingModule; // Module already generated
    }

    if (existingModule) {
      // Module placeholder exists, just generate content
      return await this.generateModuleContent(course, concept, orderIndex);
    }

    // Create module placeholder and generate content (fallback for on-demand generation)
    const newModule = this.moduleRepository.create({
      title: concept,
      orderIndex,
      course: course,
    });
    await this.moduleRepository.save(newModule);

    return await this.generateModuleContent(course, concept, orderIndex);
  }

  /**
   * Generates the next module content in the background
   */
  async generateNextModuleInBackground(courseId: number): Promise<void> {
    try {
      const course = await this.courseRepository.findOne({
        where: { id: courseId },
        relations: ['modules', 'modules.lessons'],
      });

      if (!course || !course.plannedConcepts) {
        return;
      }

      const plannedConcepts = course.plannedConcepts.split(',');
      
      // Find the next module that needs content generation
      for (let i = 0; i < plannedConcepts.length; i++) {
        const module = course.modules?.find(m => m.orderIndex === i);
        
        if (module && (!module.lessons || module.lessons.length === 0)) {
          const concept = plannedConcepts[i];
          console.log(`Generating content for module ${i + 1} in background: ${concept}`);
          await this.generateModuleContent(course, concept, i);
          console.log(`Background generation completed for module: ${concept}`);
          return; // Generate only one module at a time
        }
      }
    } catch (error) {
      console.error('Error in background module generation:', error);
    }
  }

  /**
   * Ensures a specific module exists, generating it if necessary
   */
  async ensureModuleExists(courseId: number, moduleOrderIndex: number): Promise<CourseModuleEntity | null> {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      relations: ['modules', 'modules.lessons'],
    });

    if (!course || !course.plannedConcepts) {
      return null;
    }

    const plannedConcepts = course.plannedConcepts.split(',');
    
    if (moduleOrderIndex >= plannedConcepts.length) {
      return null; // Module index out of range
    }

    // Check if module already exists
    const existingModule = course.modules?.find(m => m.orderIndex === moduleOrderIndex);
    if (existingModule && existingModule.lessons && existingModule.lessons.length > 0) {
      return existingModule;
    }

    // Generate the module on-demand
    const concept = plannedConcepts[moduleOrderIndex];
    console.log(`Generating module ${moduleOrderIndex + 1} on-demand: ${concept}`);
    return await this.generateModule(course, concept, moduleOrderIndex);
  }

  async findCourseByIdWithRelations(id: number): Promise<Course | null> {
    return this.courseRepository.findOne({
      where: { id },
      relations: ['modules', 'modules.lessons'],
    });
  }

  async findLessonById(id: number): Promise<Lesson | null> {
    const lesson = await this.lessonRepository.findOne({
      where: { id },
      relations: ['module', 'module.course'],
    });

    // If lesson doesn't exist, it might be in a module that hasn't been generated yet
    if (!lesson) {
      // Try to find if this lesson ID corresponds to a planned module
      // This is a simple approach - in a real system you might want more sophisticated logic
      return null;
    }

    return lesson;
  }

  /**
   * Finds lesson by ID, ensuring its module exists
   */
  async findLessonByIdAndEnsureModule(id: number): Promise<Lesson | null> {
    let lesson = await this.findLessonById(id);
    
    if (lesson) {
      return lesson;
    }

    // If lesson not found, check if we need to generate modules
    // This is a simplified approach - you might want to store lesson planning info
    console.log(`Lesson ${id} not found, checking if module generation is needed`);
    
    return null;
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
