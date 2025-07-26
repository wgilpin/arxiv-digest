import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Module } from './module.entity';

@Entity()
export class Course {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperArxivId: string;

  @Column()
  paperTitle: string;

  @Column()
  comprehensionLevel: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Module, module => module.course)
  modules: Module[];
}