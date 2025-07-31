import { Module } from '@nestjs/common';
import { FirebaseStorageService } from './storage.service';

@Module({
  providers: [FirebaseStorageService],
  exports: [FirebaseStorageService],
})
export class StorageModule {}