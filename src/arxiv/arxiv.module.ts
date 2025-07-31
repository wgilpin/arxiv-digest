import { Module } from '@nestjs/common';
import { ArxivService } from './arxiv.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [ArxivService],
  exports: [ArxivService],
})
export class ArxivModule {}
