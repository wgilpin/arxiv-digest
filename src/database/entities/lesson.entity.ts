import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { Module } from './module.entity';
import { Progress } from './progress.entity';

@Entity()
export class Lesson {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @Column()
  orderIndex: number;

  @ManyToOne(() => Module, (module) => module.lessons)
  module: Module;

  @OneToMany(() => Progress, (progress) => progress.lesson)
  progress: Progress[];
}
