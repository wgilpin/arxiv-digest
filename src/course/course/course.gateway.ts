import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class CourseGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('CourseGateway');

  afterInit(server: Server) {
    this.logger.log('Course WebSocket Gateway initialized');
  }

  handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinCourse')
  handleJoinCourse(client: Socket, courseId: string): void {
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      this.logger.error(`Invalid course ID: ${courseId}`);
      return;
    }
    this.joinCourseRoom(client, courseIdNum);
  }

  @SubscribeMessage('leaveCourse')
  handleLeaveCourse(client: Socket, courseId: string): void {
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      this.logger.error(`Invalid course ID: ${courseId}`);
      return;
    }
    this.leaveCourseRoom(client, courseIdNum);
  }

  // Join a course room for updates
  joinCourseRoom(client: Socket, courseId: number) {
    const roomName = `course-${courseId}`;
    client.join(roomName);
    this.logger.log(`Client ${client.id} joined course room: ${roomName}`);
  }

  // Leave a course room
  leaveCourseRoom(client: Socket, courseId: number) {
    const roomName = `course-${courseId}`;
    client.leave(roomName);
    this.logger.log(`Client ${client.id} left course room: ${roomName}`);
  }

  // Emit lesson title generated event
  emitLessonTitlesGenerated(
    courseId: number,
    moduleId: number,
    moduleTitle: string,
    lessonCount: number,
  ) {
    const roomName = `course-${courseId}`;
    this.server.to(roomName).emit('lessonTitlesGenerated', {
      courseId,
      moduleId,
      moduleTitle,
      lessonCount,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `Emitted lessonTitlesGenerated for course ${courseId}, module ${moduleId}`,
    );
  }

  // Emit lesson content generated event
  emitLessonContentGenerated(
    courseId: number,
    lessonId: number,
    lessonTitle: string,
    moduleId: number,
  ) {
    const roomName = `course-${courseId}`;
    this.server.to(roomName).emit('lessonContentGenerated', {
      courseId,
      lessonId,
      lessonTitle,
      moduleId,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `Emitted lessonContentGenerated for course ${courseId}, lesson ${lessonId}`,
    );
  }

  // Emit course status update
  emitCourseStatusUpdate(courseId: number, status: any) {
    const roomName = `course-${courseId}`;
    this.server.to(roomName).emit('courseStatusUpdate', {
      courseId,
      status,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Emitted courseStatusUpdate for course ${courseId}`);
  }

  // Emit generation start event
  emitGenerationStarted(
    courseId: number,
    type: 'lesson-titles' | 'lesson-content',
    details: any,
  ) {
    const roomName = `course-${courseId}`;
    this.server.to(roomName).emit('generationStarted', {
      courseId,
      type,
      details,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `Emitted generationStarted for course ${courseId}, type ${type}`,
    );
  }

  // Emit generation completed event
  emitGenerationCompleted(
    courseId: number,
    type: 'lesson-titles' | 'lesson-content',
    details: any,
  ) {
    const roomName = `course-${courseId}`;
    this.server.to(roomName).emit('generationCompleted', {
      courseId,
      type,
      details,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `Emitted generationCompleted for course ${courseId}, type ${type}`,
    );
  }
}
