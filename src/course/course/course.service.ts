import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CourseRepository } from '../../data/repositories/course.repository';
import { ModelCostRepository } from '../../data/repositories/model-cost.repository';
import { Course, Module, Lesson, ModelCost } from '../../firestore/interfaces/firestore.interfaces';
import { GenerationService } from '../../generation/generation/generation.service';
import { CourseGateway } from './course.gateway';

@Injectable()
export class CourseService {
  private generationLocks = new Map<string, boolean>();
  private currentGeneratingLessons = new Map<string, boolean>(); // lessonId -> isGenerating

  constructor(
    private courseRepository: CourseRepository,
    private modelCostRepository: ModelCostRepository,
    private generationService: GenerationService,
    @Inject(forwardRef(() => CourseGateway))
    private courseGateway: CourseGateway,
  ) {}

  /**
   * Check if a specific lesson is currently being generated
   */
  isLessonBeingGenerated(lessonId: string): boolean {
    return this.currentGeneratingLessons.get(lessonId) === true;
  }

  /**
   * Gets the importance level for a concept from the course data
   */
  private getConceptImportance(course: any, concept: string): 'central' | 'supporting' | 'peripheral' {
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
    userId: string,
    courseId: string,
    ratings: Record<string, number>,
  ): Promise<void> {
    const course = await this.courseRepository.findById(userId, courseId);
    if (!course) {
      throw new Error(`Course with ID ${courseId} not found.`);
    }

    const knowledgeGaps = Object.entries(ratings)
      .filter(([, rating]) => rating < 3)  // Changed from <= 3 to < 3 (exclude rating 3)
      .map(([concept]) => concept);

    // Store all concepts for future generation
    const plannedConcepts = knowledgeGaps.join(',');
    
    await this.courseRepository.update(userId, courseId, {
      plannedConcepts,
      knowledgeLevels: ratings,
    });

    // Create all module placeholders first (fast)
    const modules: Module[] = [];
    for (
      let moduleIndex = 0;
      moduleIndex < knowledgeGaps.length;
      moduleIndex++
    ) {
      const concept = knowledgeGaps[moduleIndex];

      const newModule: Module = {
        title: concept,
        description: `Learning module for ${concept}`,
        lessons: [],
      };
      
      modules[moduleIndex] = newModule;
    }

    // Save the course with modules
    await this.courseRepository.update(userId, courseId, { modules });

    // Generate lesson titles ONLY for module 1 (to minimize wait time)
    if (knowledgeGaps.length > 0) {
      const firstModule = modules[0];

      if (firstModule) {
        const firstConcept = knowledgeGaps[0];
        const importance = this.getConceptImportance(course, firstConcept);
        
        console.log(
          `Generating lesson titles for module 0: ${firstConcept} (importance: ${importance})`,
        );

        if (importance === 'peripheral') {
          // For peripheral concepts, create only one summary lesson
          const lesson: Lesson = {
            title: `Overview of ${firstConcept}`,
            content: '', // No content yet
          };
          firstModule.lessons.push(lesson);
          console.log(
            `Created single summary lesson for peripheral concept: ${firstConcept}`,
          );
        } else {
          // For central/supporting concepts, generate multiple lesson topics
          const lessonTopics = await this.generationService.generateLessonTopics(
            firstConcept,
          );
          
          // Capture token usage from lesson topics generation
          const tokenUsage = this.generationService.getAndResetTokenUsage();
          await this.updateCourseTokenUsage(userId, courseId, tokenUsage);

          // Create lesson placeholders for first module only
          for (
            let lessonIndex = 0;
            lessonIndex < lessonTopics.length;
            lessonIndex++
          ) {
            const lessonTitle = lessonTopics[lessonIndex];
            const lesson: Lesson = {
              title: lessonTitle,
              content: '', // No content yet
            };
            firstModule.lessons.push(lesson);
            console.log(
              `Created lesson placeholder: ${lessonTitle} (module 0, lesson ${lessonIndex})`,
            );
          }
        }

        // Save updated course with first module lessons
        await this.courseRepository.updateModule(userId, courseId, 0, firstModule);

        // Emit WebSocket event for lesson titles generated
        const lessonCount = importance === 'peripheral' ? 1 : firstModule.lessons.length;
        this.courseGateway.emitLessonTitlesGenerated(
          courseId,
          `${courseId}-module-0`, // Generate module ID
          firstModule.title,
          lessonCount,
        );

        // Immediately start generating lesson 1 content
        console.log('Lesson titles created for module 1, starting lesson 1 content generation');
        // Start lesson 1 generation immediately (no setImmediate to ensure spinner shows)
        this.prepareNextLesson(userId, courseId).catch((error) => {
          console.error('Failed to start lesson 1 generation after syllabus creation:', error);
        });
      }
    }
  }

  async generateRemainingLessonTitles(userId: string, courseId: string): Promise<void> {
    const lockKey = `titles-${courseId}`;

    if (this.generationLocks.get(lockKey)) {
      console.log(
        `Lesson title generation already in progress for course ${courseId}`,
      );
      return;
    }

    this.generationLocks.set(lockKey, true);

    try {
      const course = await this.courseRepository.findById(userId, courseId);

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
        const module = course.modules[moduleIndex];

        if (!module) {
          console.error(`Module not found for index ${moduleIndex}`);
          continue;
        }

        // Check if this module already has lesson titles
        if (module.lessons && module.lessons.length > 0) {
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
        this.courseGateway.emitGenerationStarted(courseId, 'lesson-titles', {
          moduleId: `${courseId}-module-${moduleIndex}`,
          moduleTitle: module.title,
          moduleOrderIndex: moduleIndex,
        });

        if (importance === 'peripheral') {
          // For peripheral concepts, create only one summary lesson
          const lesson: Lesson = {
            title: `Overview of ${concept}`,
            content: '', // No content yet
          };
          module.lessons = [lesson];
          console.log(
            `Created single summary lesson for peripheral concept: ${concept}`,
          );

          // Emit WebSocket event for lesson titles generated
          this.courseGateway.emitLessonTitlesGenerated(
            courseId,
            `${courseId}-module-${moduleIndex}`,
            module.title,
            1,
          );
        } else {
          // For central/supporting concepts, generate multiple lesson topics
          const lessonTopics =
            await this.generationService.generateLessonTopics(concept);
            
          // Capture token usage from lesson topics generation
          const tokenUsage = this.generationService.getAndResetTokenUsage();
          await this.updateCourseTokenUsage(userId, courseId, tokenUsage);

          // Create lesson placeholders
          module.lessons = [];
          for (
            let lessonIndex = 0;
            lessonIndex < lessonTopics.length;
            lessonIndex++
          ) {
            const lessonTitle = lessonTopics[lessonIndex];
            const lesson: Lesson = {
              title: lessonTitle,
              content: '', // No content yet
            };
            module.lessons.push(lesson);
            console.log(
              `Created lesson placeholder: ${lessonTitle} (module ${moduleIndex}, lesson ${lessonIndex})`,
            );
          }

          // Emit WebSocket event for lesson titles generated
          this.courseGateway.emitLessonTitlesGenerated(
            courseId,
            `${courseId}-module-${moduleIndex}`,
            module.title,
            lessonTopics.length,
          );
        }

        // Save the updated course
        await this.courseRepository.updateModule(userId, courseId, moduleIndex, module);

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

  async prepareNextLesson(userId: string, courseId: string): Promise<void> {
    const lockKey = `prepare-${courseId}`;
    let currentLessonId: string | null = null;

    if (this.generationLocks.get(lockKey)) {
      console.log(
        `Lesson preparation already in progress for course ${courseId}`,
      );
      return;
    }

    this.generationLocks.set(lockKey, true);

    try {
      const course = await this.courseRepository.findById(userId, courseId);

      if (!course) {
        console.error(`Course ${courseId} not found`);
        return;
      }

      // Find the first lesson without content
      const allLessons: { lesson: Lesson; moduleIndex: number; lessonIndex: number }[] = [];
      for (let moduleIndex = 0; moduleIndex < (course.modules?.length || 0); moduleIndex++) {
        const module = course.modules[moduleIndex];
        for (let lessonIndex = 0; lessonIndex < (module.lessons?.length || 0); lessonIndex++) {
          const lesson = module.lessons[lessonIndex];
          allLessons.push({ lesson, moduleIndex, lessonIndex });
        }
      }

      // Sort by module order, then lesson order
      allLessons.sort((a, b) => {
        const moduleOrderDiff = a.moduleIndex - b.moduleIndex;
        if (moduleOrderDiff !== 0) return moduleOrderDiff;
        return a.lessonIndex - b.lessonIndex;
      });

      console.log(`Found ${allLessons.length} total lessons for course ${courseId}`);
      
      // Find first lesson without content
      const nextLessonItem = allLessons.find((item) => !item.lesson.content || item.lesson.content === '');

      if (!nextLessonItem) {
        if (allLessons.length === 0) {
          console.log(`No lessons found for course ${courseId} - triggering lesson title generation`);
          this.generateRemainingLessonTitles(userId, courseId).catch((error) => {
            console.error('Failed to generate remaining lesson titles:', error);
          });
        } else {
          console.log(`All ${allLessons.length} lessons have content for course ${courseId}`);
        }
        return;
      }

      const nextLesson = nextLessonItem.lesson;
      const moduleIndex = nextLessonItem.moduleIndex;
      const lessonIndex = nextLessonItem.lessonIndex;
      currentLessonId = `${courseId}-module-${moduleIndex}-lesson-${lessonIndex}`;

      const module = course.modules[moduleIndex];
      if (!module) {
        console.error(`Could not find module for index ${moduleIndex}`);
        return;
      }

      const moduleConcept = course.plannedConcepts?.split(',')[moduleIndex];
      if (!moduleConcept) {
        console.error(`Could not find concept for module ${moduleIndex}`);
        return;
      }

      const knowledgeLevel = course.knowledgeLevels?.[moduleConcept] ?? 0;
      const knowledgeLevelText = this.getKnowledgeLevelText(knowledgeLevel);

      console.log(
        `Preparing lesson: ${nextLesson.title} (course ${courseId}, module ${moduleIndex}, lesson ${lessonIndex})`,
      );

      this.currentGeneratingLessons.set(currentLessonId, true);

      this.courseGateway.emitGenerationStarted(courseId, 'lesson-content', {
        lessonId: currentLessonId,
        lessonTitle: nextLesson.title,
        moduleOrderIndex: moduleIndex,
      });

      // Get previous lessons in this module for context
      const previousLessons = (module.lessons || [])
        .filter((lesson, idx) => idx < lessonIndex && lesson.content && lesson.content !== '')
        .map(lesson => ({
          title: lesson.title,
          content: lesson.content,
        }));

      console.log(`Found ${previousLessons.length} previous lessons in module for context`);

      const importance = this.getConceptImportance(course, moduleConcept);
      
      let lessonContent;
      if (importance === 'peripheral') {
        lessonContent = await this.generationService.generateSummaryLesson(
          moduleConcept,
          knowledgeLevelText,
          course.paperContent,
        );
      } else {
        lessonContent = await this.generationService.generateLessonFromExternalSources(
          moduleConcept,
          nextLesson.title,
          previousLessons,
          knowledgeLevelText,
          course.paperContent,
        );
      }
      
      // Capture token usage from lesson content generation
      const tokenUsage = this.generationService.getAndResetTokenUsage();
      await this.updateCourseTokenUsage(userId, courseId, tokenUsage);

      // Update the lesson with content
      nextLesson.content = lessonContent.content;
      nextLesson.title = this.cleanLessonTitle(lessonContent.title);
      
      // Save the updated lesson
      await this.courseRepository.updateLesson(userId, courseId, moduleIndex, lessonIndex, nextLesson);

      console.log(`Lesson content prepared: ${nextLesson.title}`);

      this.currentGeneratingLessons.delete(currentLessonId);

      // Emit WebSocket event for lesson content generated
      this.courseGateway.emitLessonContentGenerated(
        courseId,
        currentLessonId,
        nextLesson.title,
        `${courseId}-module-${moduleIndex}`,
      );

      console.log(`Emitted lessonContentGenerated event for lesson: ${currentLessonId}`);

    } catch (error) {
      console.error(
        `Error preparing next lesson for course ${courseId}:`,
        error,
      );
    } finally {
      this.generationLocks.delete(lockKey);
      if (currentLessonId) {
        this.currentGeneratingLessons.delete(currentLessonId);
      }
    }
  }

  /**
   * Updates the course with accumulated token usage by model
   */
  private async updateCourseTokenUsage(
    userId: string, 
    courseId: string, 
    tokenUsageByModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>
  ): Promise<void> {
    // Check if there are any tokens to add
    const hasTokens = Object.values(tokenUsageByModel).some(usage => usage.totalTokens > 0);
    if (!hasTokens) return;
    
    const course = await this.courseRepository.findById(userId, courseId);
    if (!course) return;
    
    // Initialize tokenUsageByModel if it doesn't exist
    const currentTokenUsage = course.tokenUsageByModel || {};
    
    // Accumulate token usage by model
    for (const [modelName, usage] of Object.entries(tokenUsageByModel)) {
      if (!currentTokenUsage[modelName]) {
        currentTokenUsage[modelName] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      }
      
      currentTokenUsage[modelName].inputTokens += usage.inputTokens;
      currentTokenUsage[modelName].outputTokens += usage.outputTokens;
      currentTokenUsage[modelName].totalTokens += usage.totalTokens;
    }
    
    // Calculate legacy totals for backward compatibility
    let totalInput = 0, totalOutput = 0, totalTokens = 0;
    for (const usage of Object.values(currentTokenUsage)) {
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      totalTokens += usage.totalTokens;
    }
    
    const updateData = {
      tokenUsageByModel: currentTokenUsage,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalTokens,
    };
    
    await this.courseRepository.update(userId, courseId, updateData);
    
    // Log the update
    for (const [modelName, usage] of Object.entries(tokenUsageByModel)) {
      console.log(`Updated course ${courseId} token usage for ${modelName}: +${usage.inputTokens} input, +${usage.outputTokens} output, +${usage.totalTokens} total`);
    }
  }

  /**
   * Calculates the generation cost for a course based on token usage and model costs
   */
  async calculateCourseGenerationCost(course: Course): Promise<number> {
    if (!course.tokenUsageByModel) {
      return 0;
    }

    const modelCostMap = await this.modelCostRepository.getModelCostMap();
    let totalCost = 0;

    for (const [modelName, usage] of Object.entries(course.tokenUsageByModel)) {
      const modelCost = modelCostMap[modelName];
      if (!modelCost) {
        console.warn(`No cost data found for model: ${modelName}`);
        continue;
      }

      // Calculate cost: (tokens / 1,000,000) * cost_per_million
      const inputCost = (usage.inputTokens / 1_000_000) * modelCost.costPerMillionInputTokens;
      const outputCost = (usage.outputTokens / 1_000_000) * modelCost.costPerMillionOutputTokens;
      
      totalCost += inputCost + outputCost;
    }

    return totalCost;
  }

  /**
   * Calculates generation costs for multiple courses efficiently
   */
  async calculateMultipleCoursesCosts(courses: Course[]): Promise<Record<string, number>> {
    const modelCostMap = await this.modelCostRepository.getModelCostMap();
    const costs: Record<string, number> = {};

    for (const course of courses) {
      if (!course.id) continue;
      
      let totalCost = 0;
      
      if (course.tokenUsageByModel) {
        for (const [modelName, usage] of Object.entries(course.tokenUsageByModel)) {
          const modelCost = modelCostMap[modelName];
          if (!modelCost) continue;

          const inputCost = (usage.inputTokens / 1_000_000) * modelCost.costPerMillionInputTokens;
          const outputCost = (usage.outputTokens / 1_000_000) * modelCost.costPerMillionOutputTokens;
          
          totalCost += inputCost + outputCost;
        }
      }
      
      costs[course.id] = totalCost;
    }

    return costs;
  }

  /**
   * Cleans lesson titles by removing markdown formatting
   */
  private cleanLessonTitle(title: string): string {
    if (!title) return title;

    return title
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^\*(.+)\*$/, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .trim();
  }

  // Public API methods
  async findCourseByIdWithRelations(userId: string, courseId: string): Promise<Course | null> {
    return this.courseRepository.findById(userId, courseId);
  }

  async findAllCourses(userId: string): Promise<Course[]> {
    return this.courseRepository.findAll(userId);
  }

  async findLessonById(userId: string, courseId: string, moduleIndex: number, lessonIndex: number): Promise<{ lesson: Lesson; module: Module; courseId: string } | null> {
    const result = await this.courseRepository.findLessonByPath(userId, courseId, moduleIndex, lessonIndex);
    if (!result) return null;
    
    return {
      ...result,
      courseId,
    };
  }

  async markLessonComplete(userId: string, courseId: string, moduleIndex: number, lessonIndex: number): Promise<void> {
    await this.courseRepository.markLessonComplete(userId, courseId, moduleIndex, lessonIndex);
  }

  async deleteCourse(userId: string, courseId: string): Promise<void> {
    console.log(`Attempting to delete course with ID: ${courseId}`);
    
    const course = await this.courseRepository.findById(userId, courseId);
    if (!course) {
      console.log(`Course with ID ${courseId} not found`);
      throw new Error(`Course with ID ${courseId} not found`);
    }

    console.log(`Found course: ${course.paperTitle}, deleting...`);
    await this.courseRepository.delete(userId, courseId);
    console.log(`Successfully deleted course ${courseId}: ${course.paperTitle}`);
  }
}