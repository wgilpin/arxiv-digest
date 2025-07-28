# The logic for showing spinners on lessons

## Overview

The spinner system provides visual feedback to users about which lessons are actively being generated. The key principle is: **spinners only show on lessons that are currently being generated, not on lessons that could potentially be generated**.

## Current Implementation

### Lesson Spinner Logic

Located in: `src/course/course/course.controller.ts`

**Conditions for showing lesson spinner:**

1. Lesson doesn't have content yet
2. Lesson is actively being generated right now (checked via `isLessonBeingGenerated()`)

### Module Spinner Logic

Located in: `src/course/course/course.controller.ts`

**Conditions for showing module spinner:**

1. Module has lesson titles (lesson titles exist)
2. The globally next lesson to be generated is in this module
3. At least one lesson has content (indicating active generation is happening)

## Generation Tracking

### CurrentGeneratingLessons Map

Located in: `src/course/course/course.service.ts`

The system uses a Map to track which specific lessons are actively being generated. This provides the source of truth for spinner visibility.

### Lifecycle Management

**When generation starts:**

- Lesson is marked as being generated in the tracking map
- WebSocket event emitted to notify UI

**When generation completes:**

- Lesson is removed from the tracking map
- WebSocket event emitted with completion status

**Error cleanup:**

- Generation tracking is cleaned up in finally blocks
- Prevents stuck spinners if generation fails

## Generation Flow & Spinner Behavior

### 1. Course Page Load

- **Action**: User visits course page
- **Generation**: Next lesson preparation starts immediately (no delays)
- **Spinner**: Shows on lesson 1 if it's being generated
- **WebSocket**: Generation started event emitted

### 2. Lesson Content Generation

- **Action**: Lesson content is being generated via LLM
- **Generation**: Lesson marked in generation tracking map
- **Spinner**: Shows on the specific lesson being generated
- **WebSocket**: Lesson content generated event when complete

### 3. User Opens Lesson

- **Action**: User clicks lesson link
- **Generation**: Background preparation triggered for next lesson
- **Spinner**: Shows on next lesson that starts generating
- **WebSocket**: UI updates in real-time

### 4. Generation Complete

- **Action**: Lesson content generation finishes
- **Generation**: Lesson removed from generation tracking map
- **Spinner**: Disappears from completed lesson
- **WebSocket**: Content generated event triggers UI update

## Key Design Decisions

### Why Not "Next Lesson" Logic?

Previous implementation showed spinners on the "next lesson globally" even if generation hadn't started. This was confusing because:

- Lesson 2 would show spinner immediately after lesson 1 was ready
- But lesson 2 generation only starts when user opens lesson 1
- Created false impression of active work

### Why Synchronous Generation Start?

Generation starts immediately (not via `setImmediate`) so that:

- Generation tracking returns true when UI renders
- Spinner shows immediately on page load
- No delay between generation start and UI feedback

### Why WebSocket + Polling Replacement?

- Real-time updates when lessons complete
- No 3-second polling delays
- Immediate UI refresh when generation status changes
- Better user experience with instant feedback

### Why Map-Based Tracking?

- Precise tracking of which specific lessons are being generated
- Avoids heuristic-based spinner logic that could be wrong
- Single source of truth for generation state

## Generation Triggers

### Automatic Generation (Lesson 1 Only)

- **When**: Course page loads or syllabus is created
- **What**: Only lesson 1 content generation starts automatically
- **Why**: Ensure users can immediately start learning

### On-Demand Generation

- **When**: User opens any lesson
- **What**: Background generation starts for the next lesson in sequence
- **Why**: Stay one step ahead without over-generating

### What Does NOT Trigger Generation

- Lesson completion (no automatic chain reaction)
- Creating lesson titles for modules 2+ (only titles, not content)
- Viewing course page multiple times (generation locks prevent duplicates)

## Troubleshooting

### Spinner Not Showing

1. Check if generation actually started before UI render
2. Verify generation tracking map is populated
3. Ensure WebSocket events are being emitted
4. Check if delays are preventing generation start

### Spinner Stuck

1. Verify generation completes and cleans up tracking
2. Check error handling in finally blocks
3. Ensure WebSocket events trigger UI updates
4. Verify lesson content is actually saved to database

### Multiple Spinners

1. Check if runaway generation is triggering
2. Verify only intended lessons are being generated
3. Ensure generation locks prevent duplicate work
4. Check if WebSocket events are firing multiple times

### Wrong Spinner Location

1. Verify generation tracking is accurate
2. Check if UI is reading from correct data source
3. Ensure WebSocket updates are applying to correct elements
4. Verify lesson/module ID matching

## User Experience Flow

### Expected Behavior

1. **Fresh Course**: No spinners initially except lesson 1 if generating
2. **Lesson 1 Generating**: Spinner shows on lesson 1 only
3. **Lesson 1 Ready**: No spinners visible
4. **User Opens Lesson 1**: Spinner appears on lesson 2 (background generation)
5. **Lesson 2 Ready**: Spinner disappears from lesson 2
6. **User Opens Lesson 2**: Spinner appears on lesson 3, and so on

### Anti-Patterns Avoided

- Spinners on all future lessons
- Spinners that don't reflect actual generation state
- Delayed spinner visibility after generation starts
- Runaway generation causing multiple spinners
- Module spinners when only generating titles (not content)

## Future Improvements

1. **Progress Indicators**: Show generation progress (0-100%)
2. **Estimated Time**: Display estimated completion time
3. **Queue Visibility**: Show which lessons are queued for generation
4. **Error States**: Different spinner styles for failed generation
5. **Batch Generation**: Option to generate multiple lessons at once
6. **Smart Preloading**: Generate next 2-3 lessons during idle time
