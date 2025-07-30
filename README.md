# ArXiv Paper Learning Tool

This project is an AI-powered learning assistant designed to help users understand academic papers from ArXiv. It works by identifying knowledge gaps, assessing the user's current understanding, and generating personalized learning paths to bridge those gaps.

## Features

- **Paper-Centric Learning**: Starts with a specific ArXiv paper you want to understand.
- **Prerequisite Mapping**: Automatically identifies the key concepts and prerequisites needed to comprehend the paper.
- **Knowledge Assessment**: Allows users to self-rate their familiarity with the identified concepts.
- **Dynamic Syllabus Generation**: Creates a custom learning syllabus with lessons derived from paper references and Wikipedia.
- **Course Management**: Save and manage multiple learning courses for different papers.
- **Progress Tracking**: Keep track of completed lessons within a course.

## Tech Stack

- **Backend**: NestJS
- **Database**: SQLite with TypeORM
- **Frontend**: Server-rendered HTML with DaisyUI
- **LLM Integration**: Google Gemini
- **Dependencies**:
  - `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/typeorm`, `typeorm`, `sqlite3`
  - `@google/generative-ai` for LLM integration
  - `axios` for HTTP requests
  - `marked` for markdown parsing
  - `xml2js` for parsing ArXiv API responses

## Installation

Follow these steps to set up the project locally.

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd digest-js
    ```

2. **Install dependencies:**
    This project uses `npm` for package management.

    ```bash
    npm install
    ```

3. **Set up environment variables:**
    Create a `.env` file in the root of the project by copying the example file:

    ```bash
    cp .env.example .env
    ```

    You will need to add your Google Gemini API key to this file.

## Getting a Gemini API Key

To use this application, you need a Google Gemini API key.

1. Go to the [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click on **"Get API key"** in the top left corner.
4. Create a new API key in a new or existing project.
5. Copy the generated API key.
6. Open your `.env` file and paste the key as the value for `GEMINI_API_KEY`:

    ```bash
    GEMINI_API_KEY=your_gemini_api_key_here
    ```

## Usage

Once the installation is complete, you can run the application using one of the following scripts.

- **Development mode:**
    This will start the server with hot-reloading enabled.

    ```bash
    npm run start:dev
    ```

- **Production mode:**
    First, build the application:

    ```bash
    npm run build
    ```

    Then, start the production server:

    ```bash
    npm run start:prod
    ```

The application will be available at `http://localhost:3000` by default (or the `PORT` specified in your `.env` file).

## Available Scripts

- `npm run build`: Compiles the TypeScript code.
- `npm run format`: Formats code using Prettier.
- `npm run start`: Starts the application.
- `npm run start:dev`: Starts the application in watch mode.
- `npm run start:debug`: Starts the application in debug mode.
- `npm run start:prod`: Starts the application in production mode.
- `npm run lint`: Lints the codebase.
- `npm run test`: Runs unit tests.
