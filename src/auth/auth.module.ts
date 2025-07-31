import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { UserService } from './user.service';
import { DataModule } from '../data/data.module';

@Module({
  imports: [DataModule],
  providers: [AuthService, AuthGuard, UserService],
  controllers: [AuthController],
  exports: [AuthService, AuthGuard, UserService],
})
export class AuthModule {}