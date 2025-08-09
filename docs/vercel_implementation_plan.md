# Plan for Adding Chat to Lessons using Vercel AI SDK

## Major Changes Overview

1. **Replace current LLM providers with Vercel AI SDK** - Unify all LLM interactions through Vercel AI SDK
2. **Add streaming chat API endpoint** - Enable real-time chat responses in lessons
3. **Create chat UI component** - Interactive chat interface embedded in lesson pages
4. **Add chat history management** - Store and retrieve conversation context
5. **WebSocket integration for real-time updates** - Leverage existing Socket.io setup

## New Architecture

### LLM Service Layer

- **Migration from custom providers to Vercel AI SDK**
  - Replace `GeminiProvider` and `GrokProvider` with Vercel AI SDK providers
  - Use `@ai-sdk/google-generative-ai` for Gemini integration
  - Use `@ai-sdk/openai` compatible provider for Grok/xAI
  - Implement streaming support via `streamText` and `generateText` functions
  - Maintain backward compatibility with existing non-streaming methods

### Chat Service Layer

- **New `ChatModule` and `ChatService`**
  - Handle chat sessions per lesson
  - Manage conversation context with lesson content
  - Store chat history in Firebase Firestore (new `ChatMessage` collection)
  - Integrate with existing `LessonProgress` tracking

### API Endpoints

- `POST /api/chat/stream` - Streaming chat endpoint
- `GET /api/chat/history/:lessonId` - Retrieve chat history
- `DELETE /api/chat/history/:lessonId` - Clear chat for a lesson

## Chat Interface Design

### UI Components

1. **Chat Section**
   - Positioned directly below lesson content
   - Full-width integrated section (not a sidebar)
   - Always visible and accessible
   - Smooth scroll to chat when user interacts

2. **Message Display**
   - User messages (right-aligned, primary color)
   - AI messages (left-aligned, with typing indicator)
   - Markdown support with syntax highlighting
   - LaTeX math rendering via MathJax
   - Max height with scrollable message history

3. **Input Area**
   - Textarea with auto-resize
   - Send button with loading state
   - Suggested prompts based on lesson content
   - Placeholder text: "Ask questions about this lesson..."
   - Always visible at bottom of chat section

4. **Chat Header**
   - Title: "Ask AI Assistant"
   - Subtitle showing context: "Questions about: [Lesson Title]"
   - Clear chat history button (optional)

### Interaction Flow

1. User scrolls down after reading lesson content → Chat is immediately available
2. System loads chat history if exists
3. User types question → Real-time streaming response
4. AI contextualizes response with current lesson content
5. Chat persists across page refreshes
6. Progress tracked alongside lesson completion

## Implementation Steps

### Phase 1: Vercel AI SDK Integration

- Install dependencies: `@ai-sdk/google-generative-ai`, `@ai-sdk/openai`, `ai`
- Refactor `LLMService` to use Vercel AI SDK
- Update all existing LLM calls to use new service
- Maintain token tracking and error handling

### Phase 2: Chat Backend

- Create `ChatModule` with controller and service
- Add `ChatMessage` collection in Firestore with proper indexes
- Implement streaming endpoint using Vercel AI SDK's `streamText`
- Add WebSocket events for real-time updates

### Phase 3: Chat Frontend

- Add chat UI components to lesson template (below content)
- Implement client-side streaming handler
- Add chat state management (messages, loading state)
- Integrate MathJax for math rendering in chat

### Phase 4: Context Enhancement

- Pass lesson content as system context
- Include paper abstract and key concepts
- Add smart prompt suggestions
- Implement chat memory across lessons in same course

## Firestore Schema Changes

```typescript
// New ChatMessage document structure in Firestore
interface ChatMessage {
  id: string;           // Auto-generated document ID
  lessonId: string;     // Reference to lesson
  courseId: string;     // Reference to course  
  userId: string;       // User's Firebase UID
  content: string;      // Message content
  role: 'user' | 'assistant';
  timestamp: Timestamp; // Firestore timestamp
  metadata?: {
    model?: string;     // Which model was used
    tokensUsed?: number;
  };
}

// Collection structure:
// /chatMessages (collection)
//   - Indexed by: lessonId, userId, timestamp
//   - Composite index: [lessonId, userId, timestamp DESC]
```

## Benefits of Vercel AI SDK

- **Unified interface** for multiple providers
- **Built-in streaming** support
- **Token usage tracking** out of the box
- **Error recovery** and retry logic
- **TypeScript support** with strong typing
- **Provider switching** without code changes
- **Edge runtime** compatibility for deployment

## Technical Details

### Current LLM Service Structure

The existing implementation uses:

- Custom provider interfaces (`LLMProvider`, `LLMRequest`, `LLMResponse`)
- Individual provider classes (`GeminiProvider`, `GrokProvider`)
- Model selector service for usage-based model selection
- Token tracking at the service level

### Model Configuration (Maintained)

Keep the existing model selection logic and environment variables:

```
GEMINI_PDF_EXTRACTION_MODEL=gemini-1.5-flash    # For PDF extraction (file upload support)
GEMINI_LARGE_MODEL=gemini-2.5-flash             # For concept extraction, lesson titles
GEMINI_FAST_MODEL=gemini-2.5-flash-lite         # For lesson generation
GROK_FAST_MODEL=grok-3-mini                     # For fast generation with Grok
GROK_LARGE_MODEL=grok-3-mini                    # For complex tasks with Grok
```

### Model Usage Rules (Maintained)

- **PDF_EXTRACTION**: Always uses `GEMINI_PDF_EXTRACTION_MODEL` (only Gemini supports file uploads)
- **CONCEPT_EXTRACTION**: Uses large model (`GEMINI_LARGE_MODEL` or `GROK_LARGE_MODEL`)
- **LESSON_TITLES**: Uses large model (`GEMINI_LARGE_MODEL` or `GROK_LARGE_MODEL`)
- **LESSON_GENERATION**: Uses fast model (`GEMINI_FAST_MODEL` or `GROK_FAST_MODEL`)
- **CHAT**: Will use fast model for interactive responses

### Vercel AI SDK Migration Strategy

1. **Provider Mapping**
   - Gemini models → `@ai-sdk/google-generative-ai`
   - Grok models → `@ai-sdk/openai` with custom base URL for xAI

2. **Method Conversion with Model Selection**

   ```typescript
   // Current approach maintained with Vercel AI SDK
   async generateContent(request: LLMRequest): Promise<LLMResponse> {
     const provider = this.modelSelector.getProviderForUsage(usage);
     const modelName = this.modelSelector.getModelForUsage(usage, provider);
     
     // Create appropriate model instance based on provider
     const model = provider === LLMProviderType.GEMINI 
       ? google(modelName)  // e.g., google('gemini-2.5-flash-lite')
       : openai(modelName, { baseURL: 'https://api.x.ai/v1' }); // for Grok
     
     const result = await generateText({
       model,
       prompt: request.prompt,
       temperature: request.temperature,
       maxTokens: request.maxTokens
     });
     
     return {
       content: result.text,
       usage: result.usage
     };
   }
   ```

3. **Streaming Implementation**

   ```typescript
   // New streaming method with model selection
   async streamChat(lessonId: string, message: string) {
     const lesson = await this.lessonService.findOne(lessonId);
     
     // Use fast model for chat responses
     const provider = this.modelSelector.getProviderForUsage(ModelUsage.LESSON_GENERATION);
     const modelName = this.modelSelector.getModelForUsage(ModelUsage.LESSON_GENERATION, provider);
     const model = provider === LLMProviderType.GEMINI 
       ? google(modelName)  // e.g., google('gemini-2.5-flash-lite')
       : openai(modelName, { baseURL: 'https://api.x.ai/v1' });
     
     const stream = await streamText({
       model,
       system: `You are helping a student understand: ${lesson.title}
                Context: ${lesson.content}`,
       messages: chatHistory,
       temperature: 0.7
     });
     return stream;
   }
   ```

### Chat Context Management

- Include lesson content as system prompt
- Add paper metadata (title, authors, abstract)
- Maintain conversation history per lesson
- Implement context window management (trim old messages)

### Frontend Integration

```javascript
// Client-side streaming handler
async function sendMessage(message) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonId, message })
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    appendToChat(chunk);
  }
}
```

### Performance Considerations

- Stream responses for better UX
- Cache common queries at lesson level in Firestore
- Implement rate limiting per user using Firestore counters
- Use Firestore batch operations for efficiency
- Optimize context size to reduce token usage

### Testing Strategy

- Unit tests for new ChatService methods
- Integration tests for streaming endpoints
- E2E tests for chat UI interactions
- Load testing for concurrent chat sessions
- Test provider failover mechanisms
