import { Controller, Post, Get, Param, Body, UseGuards, Req, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { TTSService } from './tts.service';
import { AuthGuard } from '../auth/auth.guard';
import { CourseService } from '../course/course/course.service';

@Controller('api/tts')
export class TTSController {
  constructor(
    private readonly ttsService: TTSService,
    private readonly courseService: CourseService,
  ) {}

  @Post('generate-lesson-audio')
  @UseGuards(AuthGuard)
  async generateLessonAudio(
    @Body() body: { courseId: string; moduleIndex: number; lessonIndex: number },
    @Req() req: Request & { user: { uid: string } },
  ): Promise<{ audioUrl: string; cached: boolean; cost: number }> {
    const { courseId, moduleIndex, lessonIndex } = body;

    const lessonData = await this.courseService.findLessonById(
      req.user.uid,
      courseId,
      moduleIndex,
      lessonIndex,
    );

    if (!lessonData) {
      throw new HttpException('Lesson not found', HttpStatus.NOT_FOUND);
    }

    const { lesson } = lessonData;

    if (!lesson.content || lesson.content === '') {
      throw new HttpException('Lesson has no content', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.ttsService.synthesizeLessonAudio(
        courseId,
        moduleIndex,
        lessonIndex,
        lesson.content,
      );

      return result;
    } catch (error) {
      console.error('Error generating audio:', error);
      
      // Check if it's a configuration error
      if (error.message && error.message.includes('TTS service is not configured')) {
        throw new HttpException(
          'Text-to-Speech service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      
      // Check for permission errors
      if (error.code === 7 || (error.message && error.message.includes('PERMISSION_DENIED'))) {
        throw new HttpException(
          'Text-to-Speech API access denied. Please check Google Cloud credentials.',
          HttpStatus.FORBIDDEN,
        );
      }
      
      throw new HttpException(
        'Failed to generate audio',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('lesson-audio/:courseId/:moduleIndex/:lessonIndex')
  @UseGuards(AuthGuard)
  async getLessonAudio(
    @Param('courseId') courseId: string,
    @Param('moduleIndex') moduleIndex: string,
    @Param('lessonIndex') lessonIndex: string,
    @Req() req: Request & { user: { uid: string } },
  ): Promise<{ exists: boolean; audioUrl?: string }> {
    const moduleIdx = parseInt(moduleIndex, 10);
    const lessonIdx = parseInt(lessonIndex, 10);

    if (isNaN(moduleIdx) || isNaN(lessonIdx)) {
      throw new HttpException('Invalid module or lesson index', HttpStatus.BAD_REQUEST);
    }

    const lessonData = await this.courseService.findLessonById(
      req.user.uid,
      courseId,
      moduleIdx,
      lessonIdx,
    );

    if (!lessonData) {
      throw new HttpException('Lesson not found', HttpStatus.NOT_FOUND);
    }

    const audioStatus = await this.ttsService.checkAudioExists(courseId, moduleIdx, lessonIdx);
    
    if (audioStatus.exists) {
      return { exists: true, audioUrl: audioStatus.url };
    }

    return { exists: false };
  }

  @Post('generate-audio-if-needed')
  @UseGuards(AuthGuard)
  async generateAudioIfNeeded(
    @Body() body: { courseId: string; moduleIndex: number; lessonIndex: number },
    @Req() req: Request & { user: { uid: string } },
  ): Promise<{ audioUrl: string; cached: boolean; cost: number }> {
    const { courseId, moduleIndex, lessonIndex } = body;

    const audioStatus = await this.ttsService.checkAudioExists(courseId, moduleIndex, lessonIndex);
    
    if (audioStatus.exists && audioStatus.url) {
      return { audioUrl: audioStatus.url, cached: true, cost: 0 };
    }

    return this.generateLessonAudio(body, req);
  }
}