import { 
  Controller, 
  Post, 
  Get, 
  Delete, 
  Body, 
  Param, 
  Res, 
  Req,
  UseGuards,
  HttpException,
  HttpStatus 
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ChatService } from './chat.service';
import { AuthGuard } from '../auth/auth.guard';
import { debugLog } from '../common/debug-logger';

@Controller('api/chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Stream chat response
   */
  @Post('stream')
  async streamChat(
    @Body() body: { lessonId: string; courseId: string; message: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const { lessonId, courseId, message } = body;
      
      if (!lessonId || !courseId || !message) {
        throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
      }

      debugLog(`Streaming chat for lesson ${lessonId}, user ${userId}`);

      // Save user message
      await this.chatService.saveChatMessage({
        lessonId,
        courseId,
        userId,
        content: message,
        role: 'user',
      });

      // Get the stream from the chat service
      const stream = await this.chatService.streamChatResponse(
        lessonId,
        courseId,
        userId,
        message,
      );

      // Set appropriate headers for streaming
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Stream the response manually
      for await (const chunk of stream.textStream) {
        res.write(chunk);
      }
      res.end();

      // After streaming is complete, save the assistant's response
      // Note: This requires capturing the full response, which we'll handle client-side
      
    } catch (error) {
      debugLog('Error in streamChat:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to stream chat response',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Save assistant message (called from client after streaming completes)
   */
  @Post('save-assistant-message')
  async saveAssistantMessage(
    @Body() body: { lessonId: string; courseId: string; content: string },
    @Req() req: Request,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const { lessonId, courseId, content } = body;
      
      if (!lessonId || !courseId || !content) {
        throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
      }

      const message = await this.chatService.saveChatMessage({
        lessonId,
        courseId,
        userId,
        content,
        role: 'assistant',
      });

      return { success: true, message };
    } catch (error) {
      debugLog('Error saving assistant message:', error);
      throw new HttpException(
        'Failed to save assistant message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get chat history for a lesson
   */
  @Get('history/:lessonId')
  async getChatHistory(
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const history = await this.chatService.getChatHistory(lessonId, userId);
      return { history };
    } catch (error) {
      debugLog('Error fetching chat history:', error);
      throw new HttpException(
        'Failed to fetch chat history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear chat history for a lesson
   */
  @Delete('history/:lessonId')
  async clearChatHistory(
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      await this.chatService.clearChatHistory(lessonId, userId);
      return { success: true, message: 'Chat history cleared' };
    } catch (error) {
      debugLog('Error clearing chat history:', error);
      throw new HttpException(
        'Failed to clear chat history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear chat history for a lesson (POST endpoint for UI)
   */
  @Post('clear')
  async clearChat(
    @Body() body: { lessonId: string; courseId: string },
    @Req() req: Request,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const { lessonId } = body;
      if (!lessonId) {
        throw new HttpException('Missing lessonId', HttpStatus.BAD_REQUEST);
      }

      await this.chatService.clearChatHistory(lessonId, userId);
      debugLog(`Chat cleared for lesson ${lessonId}, user ${userId}`);
      
      return { success: true, message: 'Chat history cleared successfully' };
    } catch (error) {
      debugLog('Error clearing chat:', error);
      throw new HttpException(
        'Failed to clear chat history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Non-streaming chat endpoint (fallback)
   */
  @Post('message')
  async sendMessage(
    @Body() body: { lessonId: string; courseId: string; message: string },
    @Req() req: Request,
  ) {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const { lessonId, courseId, message } = body;
      
      if (!lessonId || !courseId || !message) {
        throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
      }

      // Save user message
      await this.chatService.saveChatMessage({
        lessonId,
        courseId,
        userId,
        content: message,
        role: 'user',
      });

      // Generate response
      const response = await this.chatService.generateChatResponse(
        lessonId,
        courseId,
        userId,
        message,
      );

      // Save assistant response
      await this.chatService.saveChatMessage({
        lessonId,
        courseId,
        userId,
        content: response,
        role: 'assistant',
      });

      return { response };
    } catch (error) {
      debugLog('Error in sendMessage:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to generate chat response',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}