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

export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
  tokenUsageByModel?: Record<string, ModelTokenUsage>;
  // Legacy fields for backward compatibility
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelCost {
  id?: string;
  modelName: string;
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
  isActive: boolean;
  updatedAt: Date;
  description?: string;
}

export interface CourseProgress {
  courseId: string;
  moduleIndex: number;
  lessonIndex: number;
  completedLessons: number;
  totalLessons: number;
  lastAccessedAt: Date;
}