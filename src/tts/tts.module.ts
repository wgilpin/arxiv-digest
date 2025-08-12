import { Module } from '@nestjs/common';
import { TTSService } from './tts.service';
import { TTSController } from './tts.controller';
import { StorageModule } from '../storage/storage.module';
import { CourseModule } from '../course/course.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [StorageModule, CourseModule, AuthModule],
  providers: [TTSService],
  controllers: [TTSController],
  exports: [TTSService],
})
export class TTSModule {}