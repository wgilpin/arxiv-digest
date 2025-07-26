import { Module } from '@nestjs/common';
import { ArxivService } from './arxiv.service';

@Module({
  providers: [ArxivService]
})
export class ArxivModule {}
