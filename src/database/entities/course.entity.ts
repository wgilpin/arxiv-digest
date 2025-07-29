import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Module } from './module.entity';

@Entity()
export class Course {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperArxivId: string;

  @Column()
  paperTitle: string;

  @Column({ type: 'json', nullable: true })
  extractedConcepts: string[];

  @Column()
  comprehensionLevel: string;

  @Column({ nullable: true })
  plannedConcepts: string;

  @Column({ type: 'json', nullable: true })
  knowledgeLevels: Record<string, number>;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Module, (module) => module.course, { cascade: true })
  modules: Module[];
}
