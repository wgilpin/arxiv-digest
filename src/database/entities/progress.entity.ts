import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Lesson } from './lesson.entity';
import { User } from './user.entity';

@Entity()
export class Progress {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lessonId: number;

  @Column()
  userUid: string;

  @CreateDateColumn()
  readAt: Date;

  @ManyToOne(() => Lesson, (lesson) => lesson.progress)
  lesson: Lesson;

  @ManyToOne(() => User, (user) => user.progress)
  user: User;
}
