# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ArXiv Paper Learning Tool built with NestJS that helps users understand academic papers by creating personalized learning paths. The application downloads ArXiv papers, extracts key concepts, assesses user knowledge gaps, and generates custom courses with modules and lessons.

## Common Development Commands

```bash
# Install dependencies
npm install

# Development server with hot reload
npm run start:dev

# Build the project
npm run build

# Run in production mode
npm run start:prod

# Linting and formatting
npm run lint
npm run format

# Testing
npm run test          # Unit tests
npm run test:watch    # Watch mode
npm run test:cov      # Coverage report
npm run test:e2e      # End-to-end tests
npm run test:debug    # Debug mode
```

## Architecture Overview

### Core Modules
- **ArxivModule**: Handles ArXiv paper fetching and parsing
- **PaperModule**: Manages paper-related operations and UI
- **GenerationModule**: LLM-powered content generation services
- **CourseModule**: Course management and progress tracking

### Database Schema (SQLite + TypeORM)
The application uses SQLite with TypeORM and these main entities:
- **Course**: Represents a learning course for a specific paper
- **Module**: Groups related lessons within a course
- **Lesson**: Individual learning content units
- **Progress**: Tracks user lesson completion

Key relationships:
- Course → Modules (1:many)
- Module → Lessons (1:many) 
- Lesson → Progress (1:many)

### Data Flow
1. User provides ArXiv paper ID
2. ArxivService fetches paper metadata and content
3. LLM extracts key concepts from paper
4. User self-assesses knowledge of concepts
5. System generates personalized course structure
6. Course persisted with modules/lessons to SQLite
7. User progresses through lessons with tracking

## Key Implementation Details

### ArXiv Integration
- Uses ArXiv API (`http://export.arxiv.org/api/query`) for metadata
- Downloads and parses actual PDFs from `https://arxiv.org/pdf/{id}.pdf`
- Uses Gemini-2.0-flash for PDF text cleaning and structuring
- ArxivService handles API communication, PDF processing, and XML parsing

### Database Configuration
- SQLite database file: `database.sqlite` (in project root)
- TypeORM synchronization enabled in development
- Entities defined in `src/database/entities/`

### LLM Integration (Gemini)
- **Gemini-2.0-flash**: Used for PDF text extraction and cleaning
- **Gemini-2.5-flash**: Used for concept extraction and lesson generation
- Requires `GEMINI_API_KEY` environment variable
- Comprehensive fallback handling for API failures

### Frontend Approach
- Server-rendered HTML pages (no separate frontend framework)
- DaisyUI + Tailwind CSS for styling
- Template system with `TemplateHelper` for variable substitution
- Forms and navigation handled through NestJS controllers

## Development Notes

- The project follows NestJS module pattern with clear separation of concerns
- Real Gemini LLM integration for all AI features
- Database synchronization is enabled, so schema changes auto-apply
- Comprehensive error handling and fallbacks for all external APIs
- Main application entry point: `src/main.ts` (runs on port 3000)
- Run the tests after making changes, before claiming the code works.

## Environment Variables

Required environment variables:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000  # Optional, defaults to 3000
```

## Development Guidelines

- Do not add comments describing changes. Only add comments explaining current functionality.