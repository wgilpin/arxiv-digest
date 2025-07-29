import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Log all errors to console
    console.error('=== ERROR CAUGHT BY GLOBAL FILTER ===');
    console.error(`Timestamp: ${new Date().toISOString()}`);
    console.error(`Method: ${request.method}`);
    console.error(`URL: ${request.url}`);
    console.error(`Status: ${httpStatus}`);
    console.error(`Message: ${JSON.stringify(message)}`);
    
    if (exception instanceof Error) {
      console.error(`Error Name: ${exception.name}`);
      console.error(`Error Message: ${exception.message}`);
      console.error(`Stack Trace:`);
      console.error(exception.stack);
    } else {
      console.error(`Raw Exception:`, exception);
    }
    console.error('=========================');

    // Send error response
    response.status(httpStatus).json({
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }
}