export interface User {
  uid: string;
  email?: string;
  displayName?: string | null;
  photoURL?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Lesson {
  title: string;
  content: string;
  completedAt?: Date;
}

export interface Module {
  title: string;
  description: string;
  lessons: Lesson[];
}

export interface Course {
  id?: string;
  title: string;
  description: string;
  paperTitle: string;
  paperAuthors: string[];
  paperUrl: string;
  arxivId: string;
  modules: Module[];
  createdAt: Date;
  updatedAt: Date;
  extractedConcepts?: string[];
  conceptImportance?: Record<string, { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string }>;
  paperContent?: string;
  plannedConcepts?: string;
  knowledgeLevels?: Record<string, number>;
}

export interface CourseProgress {
  courseId: string;
  moduleIndex: number;
  lessonIndex: number;
  completedLessons: number;
  totalLessons: number;
  lastAccessedAt: Date;
}