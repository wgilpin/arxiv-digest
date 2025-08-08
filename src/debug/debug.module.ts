import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { ArxivModule } from '../arxiv/arxiv.module';

@Module({
  imports: [ArxivModule],
  controllers: [DebugController],
})
export class DebugModule {}