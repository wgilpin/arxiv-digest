import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../../firestore/firestore.service';
import { Course, Module, Lesson } from '../../firestore/interfaces/firestore.interfaces';

@Injectable()
export class CourseRepository {
  constructor(private readonly firestoreService: FirestoreService) {}

  async createCourse(userId: string, courseData: Omit<Course, 'id'>): Promise<string> {
    const courseWithTimestamps = {
      ...courseData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.firestoreService.createCourse(userId, courseWithTimestamps);
  }

  async findById(userId: string, courseId: string): Promise<Course | null> {
    const result = await this.firestoreService.getCourse(userId, courseId);
    return result as Course | null;
  }

  async findAll(userId: string): Promise<Course[]> {
    const results = await this.firestoreService.getAllCourses(userId);
    return results as Course[];
  }

  async update(userId: string, courseId: string, updates: Partial<Course>): Promise<void> {
    const updatesWithTimestamp = {
      ...updates,
      updatedAt: new Date(),
    };
    await this.firestoreService.updateCourse(userId, courseId, updatesWithTimestamp);
  }

  async delete(userId: string, courseId: string): Promise<void> {
    await this.firestoreService.deleteCourse(userId, courseId);
  }

  async updateModule(userId: string, courseId: string, moduleIndex: number, moduleData: Module): Promise<void> {
    const course = await this.findById(userId, courseId);
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }

    if (!course.modules) {
      course.modules = [];
    }

    course.modules[moduleIndex] = moduleData;
    await this.update(userId, courseId, { modules: course.modules });
  }

  async updateLesson(userId: string, courseId: string, moduleIndex: number, lessonIndex: number, lessonData: Lesson): Promise<void> {
    const course = await this.findById(userId, courseId);
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }

    if (!course.modules || !course.modules[moduleIndex]) {
      throw new Error(`Module ${moduleIndex} not found in course ${courseId}`);
    }

    if (!course.modules[moduleIndex].lessons) {
      course.modules[moduleIndex].lessons = [];
    }

    course.modules[moduleIndex].lessons[lessonIndex] = lessonData;
    await this.update(userId, courseId, { modules: course.modules });
  }

  async findLessonByPath(userId: string, courseId: string, moduleIndex: number, lessonIndex: number): Promise<{ lesson: Lesson; module: Module } | null> {
    const course = await this.findById(userId, courseId);
    if (!course || !course.modules || !course.modules[moduleIndex]) {
      return null;
    }

    const module = course.modules[moduleIndex];
    const lesson = module.lessons?.[lessonIndex];
    
    if (!lesson) {
      return null;
    }

    return { lesson, module };
  }

  async markLessonComplete(userId: string, courseId: string, moduleIndex: number, lessonIndex: number): Promise<void> {
    const course = await this.findById(userId, courseId);
    if (!course || !course.modules || !course.modules[moduleIndex]) {
      throw new Error(`Course or module not found`);
    }

    const lesson = course.modules[moduleIndex].lessons?.[lessonIndex];
    if (!lesson) {
      throw new Error(`Lesson not found`);
    }

    lesson.completedAt = new Date();
    await this.updateLesson(userId, courseId, moduleIndex, lessonIndex, lesson);
  }
}