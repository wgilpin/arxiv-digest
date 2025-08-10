import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { CourseService } from '../course/course/course.service';
import { VercelLLMService } from '../llm/vercel-llm.service';
import { ModelUsage } from '../llm/interfaces/llm.interface';
import { debugLog } from '../common/debug-logger';
import { Timestamp } from 'firebase-admin/firestore';

export interface ChatMessage {
  id?: string;
  lessonId: string;
  courseId: string;
  userId: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Timestamp;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    exerciseType?: 'quiz' | 'practice' | 'problem';
    exerciseState?: 'question' | 'evaluating' | 'hint' | 'complete';
    attemptCount?: number;
    isExerciseRequest?: boolean;
    isExerciseResponse?: boolean;
  };
}

@Injectable()
export class ChatService {
  private readonly COLLECTION_NAME = 'chatMessages';
  private readonly MAX_CONTEXT_MESSAGES = 10;
  private readonly exerciseStates = new Map<string, { attemptCount: number; currentQuestion?: string }>();

  constructor(
    private readonly firestoreService: FirestoreService,
    private readonly courseService: CourseService,
    private readonly vercelLLMService: VercelLLMService,
  ) {}

  /**
   * Check if a message is requesting an exercise
   */
  private isExerciseRequest(message: string): boolean {
    const exerciseTriggers = [
      'exercise', 'quiz', 'test', 'practice', 'problem',
      'question for me', 'quiz me', 'test my', 'give me a',
      'can you ask', 'assess my', 'check my understanding'
    ];
    const lowerMessage = message.toLowerCase();
    return exerciseTriggers.some(trigger => lowerMessage.includes(trigger));
  }

  /**
   * Get or create exercise state for a user's lesson
   */
  private getExerciseState(lessonId: string, userId: string): { attemptCount: number; currentQuestion?: string } {
    const key = `${lessonId}-${userId}`;
    if (!this.exerciseStates.has(key)) {
      this.exerciseStates.set(key, { attemptCount: 0 });
    }
    return this.exerciseStates.get(key)!;
  }

  /**
   * Get chat history for a specific lesson
   */
  async getChatHistory(lessonId: string, userId: string): Promise<ChatMessage[]> {
    try {
      const db = this.firestoreService.getDb();
      const snapshot = await db
        .collection(this.COLLECTION_NAME)
        .where('lessonId', '==', lessonId)
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(this.MAX_CONTEXT_MESSAGES * 2) // Get more than needed for context
        .get();

      const messages: ChatMessage[] = [];
      snapshot.forEach(doc => {
        messages.push({ id: doc.id, ...doc.data() } as ChatMessage);
      });

      // Reverse to get chronological order
      return messages.reverse();
    } catch (error) {
      debugLog('Error fetching chat history:', error);
      return [];
    }
  }

  /**
   * Save a chat message to Firestore
   */
  async saveChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    try {
      const db = this.firestoreService.getDb();
      const messageData = {
        ...message,
        timestamp: Timestamp.now(),
      };

      const docRef = await db.collection(this.COLLECTION_NAME).add(messageData);
      
      return {
        id: docRef.id,
        ...messageData,
      };
    } catch (error) {
      debugLog('Error saving chat message:', error);
      throw error;
    }
  }

  /**
   * Clear chat history for a specific lesson
   */
  async clearChatHistory(lessonId: string, userId: string): Promise<void> {
    try {
      const db = this.firestoreService.getDb();
      const snapshot = await db
        .collection(this.COLLECTION_NAME)
        .where('lessonId', '==', lessonId)
        .where('userId', '==', userId)
        .get();

      const batch = db.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      debugLog(`Cleared chat history for lesson ${lessonId}, user ${userId}`);
    } catch (error) {
      debugLog('Error clearing chat history:', error);
      throw error;
    }
  }

  /**
   * Stream chat response for a lesson
   */
  async streamChatResponse(
    lessonId: string,
    courseId: string,
    userId: string,
    message: string,
  ) {
    try {
      // Get lesson and course data for context
      const course = await this.courseService.getCourse(courseId);
      const lesson = await this.courseService.getLesson(lessonId);
      
      if (!lesson) {
        throw new Error('Lesson not found');
      }

      // Check if this is an exercise request
      const isExercise = this.isExerciseRequest(message);
      const exerciseState = this.getExerciseState(lessonId, userId);

      // Get recent chat history for context
      const chatHistory = await this.getChatHistory(lessonId, userId);
      const recentMessages = chatHistory.slice(-this.MAX_CONTEXT_MESSAGES);

      // Build conversation messages for the AI
      const messages = recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
      }));
      
      // Add the new user message
      messages.push({ role: 'user' as const, content: message, metadata: undefined });

      // Determine if we're in exercise mode (evaluating an answer)
      const lastAssistantMessage = [...recentMessages].reverse().find(m => m.role === 'assistant');
      const isEvaluatingAnswer = lastAssistantMessage?.metadata?.exerciseState === 'question' && !isExercise;

      // Build system prompt with lesson context
      let systemPrompt = `You are an AI tutor helping a student understand the lesson: "${lesson.title}"

LESSON CONTENT:
${lesson.content}

${lesson.figures && lesson.figures.length > 0 ? `
FIGURES IN THIS LESSON:
${lesson.figures.map(fig => `Figure ${fig.figureNumber}: ${fig.caption}`).join('\n')}
` : ''}

COURSE CONTEXT:
This lesson is part of the course about the paper: "${course?.paperTitle || 'Unknown Paper'}"

INSTRUCTIONS:
- Answer questions specifically about this lesson's content
- Reference specific parts of the lesson when relevant
- If asked about figures, refer to them by their figure numbers
- Use LaTeX notation for mathematical expressions: 
  * ALWAYS enclose inline math in single dollar signs: $x^2 + y^2 = z^2$
  * ALWAYS enclose display math in double dollar signs: $$\mathbf{e} = \frac{1}{n} \sum_{i=1}^n \mathbf{e}_i$$
  * NEVER use parentheses () or brackets [] for math
  * NEVER break dollar sign pairs - each $ must have a matching closing $
  * Examples: $\mathbf{e}_1$, $n$-dimensional, $$\sum_{i=1}^n x_i = \text{total}$$
- Be concise but thorough
- If the question is outside the scope of this lesson, politely redirect to the lesson content
- Encourage the student's learning journey`;

      // Add exercise-specific instructions
      if (isExercise) {
        systemPrompt += `

EXERCISE MODE:
The student has requested an exercise/quiz. Please:
1. Generate a thoughtful question based on the lesson content
2. The question should test understanding, not just recall
3. Make it appropriately challenging but fair
4. Format it clearly with any necessary context
5. End with "What is your answer?" or similar prompt
6. DO NOT provide the answer yet - wait for the student's response`;
        
        exerciseState.attemptCount = 0;
      } else if (isEvaluatingAnswer) {
        exerciseState.attemptCount++;
        systemPrompt += `

EVALUATING ANSWER (Attempt ${exerciseState.attemptCount}):
The student is answering your previous question. Please:
1. Evaluate their answer carefully
2. If correct: Congratulate them and explain why it's correct
3. If incorrect or partially correct:
   - For attempt 1: Give an encouraging hint without revealing the answer
   - For attempt 2: Provide a more specific hint or guide them closer
   - For attempt 3+: Explain the correct answer with the reasoning
4. Use encouraging language and focus on learning
5. After evaluation, ask if they'd like another exercise`;
      }

      // Convert messages to a single prompt for the LLM
      const prompt = messages.map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`).join('\n\n');

      // Stream the response
      const stream = await this.vercelLLMService.streamContentForUsage(
        {
          prompt,
          systemPrompt,
          temperature: 0.7,
        },
        ModelUsage.LESSON_GENERATION // Use fast model for chat
      );

      return stream;
    } catch (error) {
      debugLog('Error streaming chat response:', error);
      throw error;
    }
  }

  /**
   * Generate a non-streaming chat response (for testing or fallback)
   */
  async generateChatResponse(
    lessonId: string,
    courseId: string,
    userId: string,
    message: string,
  ): Promise<string> {
    try {
      // Get lesson and course data for context
      const course = await this.courseService.getCourse(courseId);
      const lesson = await this.courseService.getLesson(lessonId);
      
      if (!lesson) {
        throw new Error('Lesson not found');
      }

      // Get recent chat history for context
      const chatHistory = await this.getChatHistory(lessonId, userId);
      const recentMessages = chatHistory.slice(-this.MAX_CONTEXT_MESSAGES);

      // Build conversation messages for the AI
      const messages = recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));
      
      // Add the new user message
      messages.push({ role: 'user' as const, content: message });

      // Build system prompt with lesson context
      const systemPrompt = `You are an AI tutor helping a student understand the lesson: "${lesson.title}"

LESSON CONTENT:
${lesson.content}

${lesson.figures && lesson.figures.length > 0 ? `
FIGURES IN THIS LESSON:
${lesson.figures.map(fig => `Figure ${fig.figureNumber}: ${fig.caption}`).join('\n')}
` : ''}

COURSE CONTEXT:
This lesson is part of the course about the paper: "${course?.paperTitle || 'Unknown Paper'}"

INSTRUCTIONS:
- Answer questions specifically about this lesson's content
- Reference specific parts of the lesson when relevant
- If asked about figures, refer to them by their figure numbers
- Use LaTeX notation for mathematical expressions: 
  * ALWAYS enclose inline math in single dollar signs: $x^2 + y^2 = z^2$
  * ALWAYS enclose display math in double dollar signs: $$\mathbf{e} = \frac{1}{n} \sum_{i=1}^n \mathbf{e}_i$$
  * NEVER use parentheses () or brackets [] for math
  * NEVER break dollar sign pairs - each $ must have a matching closing $
  * Examples: $\mathbf{e}_1$, $n$-dimensional, $$\sum_{i=1}^n x_i = \text{total}$$
- Be concise but thorough
- If the question is outside the scope of this lesson, politely redirect to the lesson content`;

      // Convert messages to a single prompt for the LLM
      const prompt = messages.map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`).join('\n\n');

      // Generate the response
      const response = await this.vercelLLMService.generateContentForUsage(
        {
          prompt,
          systemPrompt,
          temperature: 0.7,
        },
        ModelUsage.LESSON_GENERATION // Use fast model for chat
      );

      return response.content;
    } catch (error) {
      debugLog('Error generating chat response:', error);
      throw error;
    }
  }
}