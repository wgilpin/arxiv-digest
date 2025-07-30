import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
} from 'typeorm';
import { Module } from './module.entity';
import { User } from './user.entity';

@Entity()
export class Course {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperArxivId: string;

  @Column()
  userUid: string;

  @Column()
  paperTitle: string;

  @Column({ type: 'json', nullable: true })
  extractedConcepts: string[];

  @Column({ type: 'json', nullable: true })
  conceptImportance: Record<string, { importance: 'central' | 'supporting' | 'peripheral'; reasoning: string }>;

  @Column()
  comprehensionLevel: string;

  @Column({ nullable: true })
  plannedConcepts: string;

  @Column({ type: 'json', nullable: true })
  knowledgeLevels: Record<string, number>;

  @Column({ type: 'text', nullable: true })
  paperContent: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Module, (module) => module.course, { cascade: true })
  modules: Module[];

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
