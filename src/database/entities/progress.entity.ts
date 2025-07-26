import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Lesson } from './lesson.entity';

@Entity()
export class Progress {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lessonId: number;

  @CreateDateColumn()
  readAt: Date;

  @ManyToOne(() => Lesson, (lesson) => lesson.progress)
  lesson: Lesson;
}
