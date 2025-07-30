import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { Request, Response, NextFunction } from 'express';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  try {
    console.log('Starting NestJS application...');
    console.log('Environment check:', {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      FIREBASE_API_KEY: process.env.FIREBASE_API_KEY ? 'SET' : 'MISSING'
    });

    const app = await NestFactory.create(AppModule, { 
      logger: ['error', 'warn', 'log', 'debug', 'verbose']
    });

    // Add cookie parser middleware
    app.use(cookieParser());

    // Add global exception filter for comprehensive error logging
    app.useGlobalFilters(new GlobalExceptionFilter());

    // Add simple request logging middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
      next();
    });

    const port = process.env.PORT ?? 3000;
    console.log(`Server starting on port ${port}`);
    await app.listen(port, "0.0.0.0");
    console.log(`Server successfully started on port ${port}`);
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}
void bootstrap();
