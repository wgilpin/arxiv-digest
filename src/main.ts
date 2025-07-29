import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { 
    logger: ['error', 'warn', 'log', 'debug', 'verbose']
  });

  // Add global exception filter for comprehensive error logging
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Add simple request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  console.log(`Server starting on port ${process.env.PORT ?? 3000}`);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
