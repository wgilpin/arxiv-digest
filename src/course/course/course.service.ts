import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../../database/entities/course.entity';
import { Module as CourseModuleEntity } from '../../database/entities/module.entity';
import { Lesson } from '../../database/entities/lesson.entity';
import { Progress } from '../../database/entities/progress.entity';
import { GenerationService } from '../../generation/generation/generation.service';
import { CourseGateway } from './course.gateway';

@Injectable()
export class CourseService {
  private generationLocks = new Map<string, boolean>();
  private currentGeneratingLessons = new Map<number, boolean>(); // lessonId -> isGenerating

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
    @Inject(forwardRef(() => CourseGateway))
    private courseGateway: CourseGateway,
  ) {}

  /**
   * Check if a specific lesson is currently being generated
   */
  isLessonBeingGenerated(lessonId: number): boolean {
    return this.currentGeneratingLessons.get(lessonId) === true;
  }

  /**
   * Gets the importance level for a concept from the course data
   */
  private getConceptImportance(course: Course, concept: string): 'central' | 'supporting' | 'peripheral' {
    if (!course.conceptImportance || !course.conceptImportance[concept]) {
      return 'central'; // Default to central if no importance data
    }
    return course.conceptImportance[concept].importance;
  }

  /**
   * Convert knowledge level number to descriptive text
   */
  private getKnowledgeLevelText(level: number): string {
    switch (level) {
      case 0:
        return 'No knowledge of the concept';
      case 1:
        return 'Basic understanding of the concept';
      case 2:
        return 'Fair understanding of the concept without technical details';
      default:
        return 'No knowledge of the concept'; // fallback
    }
  }

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
      .filter(([, rating]) => rating < 3)  // Changed from <= 3 to < 3 (exclude rating 3)
      .map(([concept]) => concept);

    // Store all concepts for future generation
    course.plannedConcepts = knowledgeGaps.join(',');
    // Store the knowledge level ratings
    course.knowledgeLevels = ratings;
    await this.courseRepository.save(course);

    // Create all module placeholders first (fast)
    for (
      let moduleIndex = 0;
      moduleIndex < knowledgeGaps.length;
      moduleIndex++
    ) {
      const concept = knowledgeGaps[moduleIndex];

      const newModule = this.moduleRepository.create({
        title: concept,
        orderIndex: moduleIndex,
        course: course,
      });
      await this.moduleRepository.save(newModule);
    }

    // Generate lesson titles ONLY for module 1 (to minimize wait time)
    if (knowledgeGaps.length > 0) {
      const firstModule = await this.moduleRepository.findOne({
        where: { course: { id: courseId }, orderIndex: 0 },
      });

      if (firstModule) {
        const firstConcept = knowledgeGaps[0];
        const importance = this.getConceptImportance(course, firstConcept);
        
        console.log(
          `Generating lesson titles for module 0: ${firstConcept} (importance: ${importance})`,
        );

        if (importance === 'peripheral') {
          // For peripheral concepts, create only one summary lesson
          const lesson = this.lessonRepository.create({
            title: `Overview of ${firstConcept}`,
            content: null, // No content yet
            orderIndex: 0,
            module: firstModule,
          });
          await this.lessonRepository.save(lesson);
          console.log(
            `Created single summary lesson for peripheral concept: ${firstConcept}`,
          );
        } else {
          // For central/supporting concepts, generate multiple lesson topics
          const lessonTopics = await this.generationService.generateLessonTopics(
            firstConcept,
          );

          // Create lesson placeholders for first module only
          for (
            let lessonIndex = 0;
            lessonIndex < lessonTopics.length;
            lessonIndex++
          ) {
            const lessonTitle = lessonTopics[lessonIndex];
            const lesson = this.lessonRepository.create({
              title: lessonTitle,
              content: null, // No content yet
              orderIndex: lessonIndex,
              module: firstModule,
            });
            await this.lessonRepository.save(lesson);
            console.log(
              `Created lesson placeholder: ${lessonTitle} (module 0, lesson ${lessonIndex})`,
            );
          }
        }

        // Emit WebSocket event for lesson titles generated
        const lessonCount = importance === 'peripheral' ? 1 : (await this.lessonRepository.count({ where: { module: { id: firstModule.id } } }));
        this.courseGateway.emitLessonTitlesGenerated(
          courseId,
          firstModule.id,
          firstModule.title,
          lessonCount,
        );

        // Immediately start generating lesson 1 content
        console.log('Lesson titles created for module 1, starting lesson 1 content generation');
        // Start lesson 1 generation immediately (no setImmediate to ensure spinner shows)
        this.prepareNextLesson(courseId).catch((error) => {
          console.error('Failed to start lesson 1 generation after syllabus creation:', error);
        });
      }
    }
  }

  /**
   * Generates lesson titles for all remaining modules (modules 2+)
   */
  async generateRemainingLessonTitles(courseId: number): Promise<void> {
    const lockKey = `titles-${courseId}`;

    if (this.generationLocks.get(lockKey)) {
      console.log(
        `Lesson title generation already in progress for course ${courseId}`,
      );
      return;
    }

    this.generationLocks.set(lockKey, true);

    try {
      const course = await this.courseRepository.findOne({
        where: { id: courseId },
        relations: ['modules'],
      });

      if (!course || !course.plannedConcepts) {
        return;
      }

      const plannedConcepts = course.plannedConcepts.split(',');

      // Generate lesson titles for modules 2+ (skipping module 0 which is already done)
      for (
        let moduleIndex = 1;
        moduleIndex < plannedConcepts.length;
        moduleIndex++
      ) {
        const concept = plannedConcepts[moduleIndex];
        const module = course.modules?.find(
          (m) => m.orderIndex === moduleIndex,
        );

        if (!module) {
          console.error(`Module not found for index ${moduleIndex}`);
          continue;
        }

        // Check if this module already has lesson titles
        const existingLessons = await this.lessonRepository.count({
          where: { module: { id: module.id } },
        });

        if (existingLessons > 0) {
          console.log(
            `Module ${moduleIndex} already has lesson titles, skipping`,
          );
          continue;
        }

        const importance = this.getConceptImportance(course, concept);
        
        console.log(
          `Generating lesson titles for module ${moduleIndex}: ${concept} (importance: ${importance})`,
        );

        // Emit WebSocket event for title generation started
        this.courseGateway.emitGenerationStarted(course.id, 'lesson-titles', {
          moduleId: module.id,
          moduleTitle: module.title,
          moduleOrderIndex: moduleIndex,
        });

        if (importance === 'peripheral') {
          // For peripheral concepts, create only one summary lesson
          const lesson = this.lessonRepository.create({
            title: `Overview of ${concept}`,
            content: null, // No content yet
            orderIndex: 0,
            module: module,
          });
          await this.lessonRepository.save(lesson);
          console.log(
            `Created single summary lesson for peripheral concept: ${concept}`,
          );

          // Emit WebSocket event for lesson titles generated
          this.courseGateway.emitLessonTitlesGenerated(
            course.id,
            module.id,
            module.title,
            1,
          );
        } else {
          // For central/supporting concepts, generate multiple lesson topics
          const lessonTopics =
            await this.generationService.generateLessonTopics(concept);

          // Create lesson placeholders
          for (
            let lessonIndex = 0;
            lessonIndex < lessonTopics.length;
            lessonIndex++
          ) {
            const lessonTitle = lessonTopics[lessonIndex];
            const lesson = this.lessonRepository.create({
              title: lessonTitle,
              content: null, // No content yet
              orderIndex: lessonIndex,
              module: module,
            });
            await this.lessonRepository.save(lesson);
            console.log(
              `Created lesson placeholder: ${lessonTitle} (module ${moduleIndex}, lesson ${lessonIndex})`,
            );
          }

          // Emit WebSocket event for lesson titles generated
          this.courseGateway.emitLessonTitlesGenerated(
            course.id,
            module.id,
            module.title,
            lessonTopics.length,
          );
        }

        // Lesson titles created - content will be generated when user opens previous lessons
      }

      console.log('Completed generating remaining lesson titles');
    } catch (error) {
      console.error(
        `Error generating remaining lesson titles for course ${courseId}:`,
        error,
      );
    } finally {
      this.generationLocks.delete(lockKey);
    }
  }

  /**
   * Finds the next lesson that needs content and generates it
   */
  async prepareNextLesson(courseId: number): Promise<void> {
    const lockKey = `prepare-${courseId}`;
    let currentLessonId: number | null = null;

    // Prevent multiple simultaneous preparations for the same course
    if (this.generationLocks.get(lockKey)) {
      console.log(
        `Lesson preparation already in progress for course ${courseId}`,
      );
      return;
    }

    this.generationLocks.set(lockKey, true);

    try {
      const course = await this.courseRepository.findOne({
        where: { id: courseId },
        relations: ['modules', 'modules.lessons'],
      });

      if (!course) {
        console.error(`Course ${courseId} not found`);
        return;
      }

      // Find the first lesson without content
      const allLessons: { lesson: Lesson; moduleOrderIndex: number }[] = [];
      for (const module of course.modules || []) {
        for (const lesson of module.lessons || []) {
          allLessons.push({ lesson, moduleOrderIndex: module.orderIndex });
        }
      }

      // Sort by module order, then lesson order
      allLessons.sort((a, b) => {
        const moduleOrderDiff = a.moduleOrderIndex - b.moduleOrderIndex;
        if (moduleOrderDiff !== 0) return moduleOrderDiff;
        return a.lesson.orderIndex - b.lesson.orderIndex;
      });

      console.log(`Found ${allLessons.length} total lessons for course ${courseId}`);
      
      // Find first lesson without content
      const nextLessonItem = allLessons.find((item) => !item.lesson.content);

      if (!nextLessonItem) {
        if (allLessons.length === 0) {
          console.log(`No lessons found for course ${courseId} - triggering lesson title generation`);
          // No lessons exist yet, trigger lesson title generation for remaining modules
          this.generateRemainingLessonTitles(courseId).catch((error) => {
            console.error('Failed to generate remaining lesson titles:', error);
          });
        } else {
          console.log(`All ${allLessons.length} lessons have content for course ${courseId}`);
        }
        return;
      }

      const nextLesson = nextLessonItem.lesson;
      const moduleOrderIndex = nextLessonItem.moduleOrderIndex;
      currentLessonId = nextLesson.id;

      // Find the actual module entity
      const module = course.modules?.find(m => m.orderIndex === moduleOrderIndex);
      if (!module) {
        console.error(`Could not find module for order index ${moduleOrderIndex}`);
        return;
      }

      const moduleConcept =
        course.plannedConcepts?.split(',')[moduleOrderIndex];
      if (!moduleConcept) {
        console.error(`Could not find concept for module ${moduleOrderIndex}`);
        return;
      }

      // Get the user's knowledge level for this concept
      const knowledgeLevel = course.knowledgeLevels?.[moduleConcept] ?? 0;
      const knowledgeLevelText = this.getKnowledgeLevelText(knowledgeLevel);

      console.log(
        `Preparing lesson: ${nextLesson.title} (course ${courseId}, module ${moduleOrderIndex}, lesson ${nextLesson.orderIndex})`,
      );

      // Mark this lesson as being generated
      this.currentGeneratingLessons.set(nextLesson.id, true);

      // Emit generation started event
      this.courseGateway.emitGenerationStarted(courseId, 'lesson-content', {
        lessonId: nextLesson.id,
        lessonTitle: nextLesson.title,
        moduleOrderIndex,
      });

      // Get previous lessons in this module for context
      const previousLessons = (module.lessons || [])
        .filter((lesson): lesson is typeof lesson & { content: string } => lesson.orderIndex < nextLesson.orderIndex && lesson.content !== null)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(lesson => ({
          title: lesson.title,
          content: lesson.content,
        }));

      console.log(`Found ${previousLessons.length} previous lessons in module for context`);

      // Check if this is a peripheral concept to use summary generation
      const importance = this.getConceptImportance(course, moduleConcept);
      
      let lessonContent;
      if (importance === 'peripheral') {
        // For peripheral concepts, generate a single summary lesson
        lessonContent = await this.generationService.generateSummaryLesson(
          moduleConcept,
          knowledgeLevelText,
          course.paperContent,
        );
      } else {
        // For central/supporting concepts, generate detailed lessons
        lessonContent = await this.generationService.generateLessonFromExternalSources(
          moduleConcept,
          nextLesson.title,
          previousLessons,
          knowledgeLevelText,
          course.paperContent,
        );
      }

      // Update the lesson with content
      nextLesson.content = lessonContent.content;
      nextLesson.title = this.cleanLessonTitle(lessonContent.title); // Allow AI to refine the title but clean it
      await this.lessonRepository.save(nextLesson);

      console.log(`Lesson content prepared: ${nextLesson.title}`);

      // Mark this lesson as no longer being generated
      this.currentGeneratingLessons.delete(nextLesson.id);

      // Emit WebSocket event for lesson content generated
      this.courseGateway.emitLessonContentGenerated(
        courseId,
        nextLesson.id,
        nextLesson.title,
        module.id,
      );

      // Lesson completed - next lesson will be generated when user opens this one
    } catch (error) {
      console.error(
        `Error preparing next lesson for course ${courseId}:`,
        error,
      );
    } finally {
      this.generationLocks.delete(lockKey);
      // Clean up generation tracking in case of error
      if (currentLessonId) {
        this.currentGeneratingLessons.delete(currentLessonId);
      }
    }
  }

  /**
   * Generates content for a specific lesson on-demand
   */
  async generateSpecificLesson(lessonId: number): Promise<void> {
    const lockKey = `lesson-${lessonId}`;

    if (this.generationLocks.get(lockKey)) {
      console.log(`Lesson ${lessonId} already being generated`);
      return;
    }

    this.generationLocks.set(lockKey, true);

    try {
      const lesson = await this.lessonRepository.findOne({
        where: { id: lessonId },
        relations: ['module', 'module.course'],
      });

      if (!lesson) {
        console.error(`Lesson ${lessonId} not found`);
        return;
      }

      if (lesson.content) {
        console.log(`Lesson ${lessonId} already has content`);
        return;
      }

      const course = lesson.module.course;
      const moduleOrderIndex = lesson.module.orderIndex;

      const moduleConcept =
        course.plannedConcepts?.split(',')[moduleOrderIndex];
      if (!moduleConcept) {
        console.error(`Could not find concept for module ${moduleOrderIndex}`);
        return;
      }

      // Get the user's knowledge level for this concept
      const knowledgeLevel = course.knowledgeLevels?.[moduleConcept] ?? 0;
      const knowledgeLevelText = this.getKnowledgeLevelText(knowledgeLevel);

      console.log(
        `Generating specific lesson: ${lesson.title} (lesson ${lessonId}, module ${moduleOrderIndex})`,
      );

      // Mark this lesson as being generated
      this.currentGeneratingLessons.set(lesson.id, true);

      // Emit generation started event
      this.courseGateway.emitGenerationStarted(course.id, 'lesson-content', {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        moduleOrderIndex,
      });

      // Get previous lessons in this module for context
      const module = await this.moduleRepository.findOne({
        where: { id: lesson.module.id },
        relations: ['lessons'],
      });

      const previousLessons = (module?.lessons || [])
        .filter((l): l is typeof l & { content: string } => l.orderIndex < lesson.orderIndex && l.content !== null)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(l => ({
          title: l.title,
          content: l.content,
        }));

      console.log(`Found ${previousLessons.length} previous lessons in module for context`);

      // Check if this is a peripheral concept to use summary generation
      const importance = this.getConceptImportance(course, moduleConcept);
      
      let lessonContent;
      if (importance === 'peripheral') {
        // For peripheral concepts, generate a single summary lesson
        lessonContent = await this.generationService.generateSummaryLesson(
          moduleConcept,
          knowledgeLevelText,
          course.paperContent,
        );
      } else {
        // For central/supporting concepts, generate detailed lessons
        lessonContent = await this.generationService.generateLessonFromExternalSources(
          moduleConcept,
          lesson.title,
          previousLessons,
          knowledgeLevelText,
          course.paperContent,
        );
      }

      // Update the lesson with content
      lesson.content = lessonContent.content;
      lesson.title = this.cleanLessonTitle(lessonContent.title); // Allow AI to refine the title but clean it
      await this.lessonRepository.save(lesson);

      console.log(`Specific lesson content generated: ${lesson.title}`);

      // Mark this lesson as no longer being generated
      this.currentGeneratingLessons.delete(lesson.id);

      // Emit WebSocket event for lesson content generated
      this.courseGateway.emitLessonContentGenerated(
        course.id,
        lesson.id,
        lesson.title,
        lesson.module.id,
      );

      // Lesson completed - next lesson will be generated when user opens this one
    } catch (error) {
      console.error(`Error generating specific lesson ${lessonId}:`, error);
    } finally {
      this.generationLocks.delete(lockKey);
      // Clean up generation tracking in case of error
      this.currentGeneratingLessons.delete(lessonId);
    }
  }

  /**
   * Cleans lesson titles by removing markdown formatting
   */
  private cleanLessonTitle(title: string): string {
    if (!title) return title;

    return title
      .replace(/^\*\*(.+)\*\*$/, '$1') // Remove **title** wrapper
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove any **text** within title
      .replace(/^\*(.+)\*$/, '$1') // Remove *title* wrapper
      .replace(/\*(.+?)\*/g, '$1') // Remove any *text* within title
      .trim();
  }

  // Legacy method - no longer used with the new lazy generation system

  // Legacy methods - no longer used with the new lazy generation system

  /**
   * Ensures a specific module exists - now just returns existing module since all are created at syllabus time
   */
  async ensureModuleExists(
    courseId: number,
    moduleOrderIndex: number,
  ): Promise<CourseModuleEntity | null> {
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

    // Return existing module (all modules are created during syllabus generation)
    return (
      course.modules?.find((m) => m.orderIndex === moduleOrderIndex) || null
    );
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
    const lesson = await this.findLessonById(id);

    if (lesson) {
      return lesson;
    }

    // If lesson not found, check if we need to generate modules
    // This is a simplified approach - you might want to store lesson planning info
    console.log(
      `Lesson ${id} not found, checking if module generation is needed`,
    );

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

  async deleteCourse(id: number): Promise<void> {
    console.log(`Attempting to delete course with ID: ${id}`);
    
    const course = await this.courseRepository.findOne({
      where: { id },
      relations: ['modules', 'modules.lessons', 'modules.lessons.progress'],
    });

    if (!course) {
      console.log(`Course with ID ${id} not found`);
      throw new Error(`Course with ID ${id} not found`);
    }

    console.log(`Found course: ${course.paperTitle}, deleting...`);

    // Delete progress records first
    for (const module of course.modules || []) {
      for (const lesson of module.lessons || []) {
        if (lesson.progress && lesson.progress.length > 0) {
          await this.progressRepository.remove(lesson.progress);
          console.log(`Deleted ${lesson.progress.length} progress records for lesson ${lesson.id}`);
        }
      }
    }

    // Delete lessons
    for (const module of course.modules || []) {
      if (module.lessons && module.lessons.length > 0) {
        await this.lessonRepository.remove(module.lessons);
        console.log(`Deleted ${module.lessons.length} lessons for module ${module.id}`);
      }
    }

    // Delete modules
    if (course.modules && course.modules.length > 0) {
      await this.moduleRepository.remove(course.modules);
      console.log(`Deleted ${course.modules.length} modules for course ${id}`);
    }

    // Finally delete the course
    await this.courseRepository.remove(course);
    console.log(`Successfully deleted course ${id}: ${course.paperTitle}`);
  }
}
