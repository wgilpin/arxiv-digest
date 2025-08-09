import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LLMModule } from '../llm/llm.module';
import { FirestoreModule } from '../firestore/firestore.module';
import { CourseModule } from '../course/course.module';
import { AuthModule } from '../auth/auth.module';
import { VercelLLMService } from '../llm/vercel-llm.service';
import { VercelUnifiedProvider } from '../llm/providers/vercel-unified.provider';
import { ModelSelectorService } from '../llm/model-selector.service';

@Module({
  imports: [LLMModule, FirestoreModule, CourseModule, AuthModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    VercelLLMService,
    VercelUnifiedProvider,
    ModelSelectorService,
  ],
  exports: [ChatService],
})
export class ChatModule {}