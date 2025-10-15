# Chat Mode Feature Status

This document captures the current state of the "chat mode" / iterative chat experience to provide a clear picture of what exists and what remains unimplemented.

## Overview

**Intended Feature**: Multi-turn conversational image editing where users can iteratively refine generated images through a chat interface. Example workflow:
1. User uploads image of blue car
2. User: "Turn this car into a convertible"
3. Model generates convertible, remembers context
4. User: "Now change the color to yellow"
5. Model applies change to the same car, maintaining conversation history

**Current Status**: ❌ **Not Implemented** - Only UI scaffolding exists; no functional backend logic.

---

## Existing Pieces (Infrastructure Only)

### 1. Gemini SDK Helper (`lib/gemini.js:73-85`)
**What it does**: Exports `createImageChat()` function that instantiates a Gemini chat session using the `@google/genai` SDK.

```javascript
export function createImageChat({ history = [], aspectRatio = "1:1" } = {}) {
  return ai.chats.create({
    model: MODEL_ID,
    history,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio },
    },
  });
}
```

**Actual usage**: None. This function is never called anywhere in the codebase.

### 2. Composer State (`store/useComposer.js:14,28,87`)
**What it does**: Includes `chatMode` boolean in the Zustand store state and sends it to the backend.

- **Line 14**: Default state includes `chatMode: false`
- **Line 28**: Exposed in store selectors
- **Line 87**: Included in job submission payload as `inputs.chatMode`

**Data flow**: Frontend → API → Firestore... but then ignored by executor.

### 3. UI Checkbox (`components/JobComposer.js:556-564`)
**What it does**: Renders a checkbox labeled "Keep chat history (beta)" that toggles `chatMode` state.

```javascript
<input
  type="checkbox"
  checked={chatMode}
  onChange={(event) => setField("chatMode", event.target.checked)}
  className="..."
/>
Keep chat history (beta)
```

**User impact**: Checking the box changes nothing in actual behavior; it's a visual-only toggle.

### 4. Chat Page Placeholder (`app/(ui)/chat/page.js`, `components/ChatPane.js:1-11`)
**What it does**: Renders a static placeholder page at `/chat` route.

**Displayed message**:
> "The iterative nanobanana chat experience will be implemented after the core job flow is live."

**Functionality**: Zero. No inputs, no conversation UI, no API calls.

### 5. Documentation References
- **`project_plan.md:14,77-79,183-186,301`**: Describes intended chat mode behavior, `chatTurns` collection schema, and iterative refinement workflows
- **`project_plan_code.md:146-156,729-734`**: Code examples for chat implementation (not yet integrated)

---

## Missing Functionality (What Doesn't Exist)

### 1. Backend Execution Logic
**Location**: `lib/job-executor.js:58-84`

**Current code**: Completely ignores `inputs.chatMode` parameter.

```javascript
const {
  imageIds = [],
  refUrls = [],
  aspectRatio = "1:1",
  imageOnly = false,
} = inputs;
// chatMode is destructured from inputs but never used

const output = await generateImage({ /* always single-shot */ });
```

**What's missing**:
- No conditional logic to use `createImageChat()` when `chatMode: true`
- No calls to `chat.sendMessage()` for multi-turn conversations
- All jobs use stateless `generateContent()` API

### 2. Chat Session Management
**What's missing**:
- No session creation/retrieval logic
- No session storage (in-memory or database)
- No session-to-girl or session-to-user mapping
- No session expiration/cleanup

### 3. Chat History Persistence
**Firestore gap**:
- Planned `chatTurns` collection (documented in `project_plan.md:77-79`) never created
- No `chatSessions` collection
- No code to read/write conversation history
- No relationship between jobs and chat turns

**Database helpers**: `lib/db.js` contains no chat-related functions.

### 4. API Routes
**Missing endpoints**:
- `POST /api/chat/sessions` - Create new session
- `GET /api/chat/sessions/:id` - Retrieve history
- `POST /api/chat/sessions/:id/message` - Send message
- `DELETE /api/chat/sessions/:id` - Clear history

**Verification**: No `app/api/chat/` directory exists.

### 5. Chat UI Component
**`components/ChatPane.js` is a 11-line stub**:
- No message history display
- No input field for prompts
- No image attachment area
- No "Send" button
- No polling/streaming for responses

---

## Architectural Gap: UI → Backend Disconnect

### Data Flow (Current)
```
User checks "Keep chat history (beta)"
  → chatMode: true stored in Zustand
  → POST /api/jobs with inputs.chatMode: true
  → Job saved to Firestore with chatMode field
  → job-executor.js runs executeJob()
  → IGNORES chatMode, calls generateImage() (single-shot)
  → No chat session created
  → No history preserved
```

### What's Needed
```
User checks "Keep chat history (beta)"
  → chatMode: true
  → POST /api/jobs
  → job-executor.js checks if chatMode === true
  → IF TRUE:
      - Retrieve or create chat session
      - Call chat.sendMessage() instead of generateContent()
      - Append turn to chatTurns collection
      - Link result to session
  → ELSE:
      - Use existing single-shot logic
```

---

## Gemini SDK Methods: Current vs. Needed

### Currently Used: `ai.models.generateContent()`
**Location**: `lib/gemini.js:48-52`

**Behavior**: Stateless, single-shot generation. No memory between calls.

```javascript
const res = await ai.models.generateContent({
  model: MODEL_ID,
  contents: [{ role: "user", parts }],
  config,
});
```

### Needed for Chat: `chat.sendMessage()`
**Reference**: `lib/gemini.js:73-85` (function exists but unused)

**Behavior**: Stateful, multi-turn conversation. Maintains context.

```javascript
const chat = ai.chats.create({ model, history, config });
const response = await chat.sendMessage({ parts: [...] });
// Next call to chat.sendMessage() remembers previous turn
```

**Key difference**: Chat sessions accumulate history; each `sendMessage()` includes all prior turns automatically.

---

## Current Behavior (What Actually Happens)

### Scenario 1: User Enables Chat Mode
1. User checks "Keep chat history (beta)" checkbox
2. Composer shows `chatMode: true`
3. User submits job with prompt "Turn this car into a convertible"
4. Backend receives `inputs.chatMode: true` but ignores it
5. Executor calls `generateImage()` (stateless)
6. Image generated successfully
7. **User submits follow-up**: "Now make it yellow"
8. **Backend has ZERO memory** of the previous car/convertible context
9. Model treats it as fresh request, may produce unrelated yellow object

**Result**: Chat mode checkbox is cosmetic; no actual conversation occurs.

### Scenario 2: User Visits `/chat` Page
1. User navigates to `/chat` route
2. Sees placeholder message: *"The iterative nanobanana chat experience will be implemented..."*
3. No interactive elements available
4. User can only leave the page

---

## How to Verify Current Status

### Check 1: chatMode Parameter is Ignored
```bash
# Search for chatMode usage in job executor
grep -n "chatMode" lib/job-executor.js
# Result: No matches (parameter is destructured but unused)
```

### Check 2: No Chat API Routes
```bash
# Check for chat API directory
ls app/api/chat/
# Result: No such file or directory
```

### Check 3: createImageChat is Never Called
```bash
# Search for calls to createImageChat
grep -r "createImageChat(" --include="*.js" --include="*.jsx"
# Results: Only the definition in lib/gemini.js, no invocations
```

### Check 4: No chatTurns Collection Usage
```bash
# Search for chatTurns in database code
grep -r "chatTurns" lib/ app/api/
# Result: No matches (collection never accessed)
```

### Check 5: ChatPane is Placeholder
```bash
# Check ChatPane line count
wc -l components/ChatPane.js
# Result: 11 lines (just a div with placeholder text)
```

---

## Why This Feature Was Deferred

**From `components/ChatPane.js:6-8`**:
> "The iterative nanobanana chat experience will be implemented after the core job flow is live."

**Context**: The team prioritized building the foundational job queue, image generation pipeline, and library management before tackling stateful chat sessions. The current scaffolding (checkbox, placeholder page, helper function) was added to reserve the UI space and document the intended architecture.

**Current project phase**: Core job flow ✅ complete; chat mode ⏳ pending.

---

## References

- **Intended behavior**: `project_plan.md:183-186` (chat mode workflow)
- **Data model**: `project_plan.md:77-79` (chatTurns schema)
- **Code examples**: `project_plan_code.md:146-156,729-734` (createImageChat usage)
- **Gemini Chat API docs**: `project_plan_code.md:5` (references Google Gen AI SDK)

---

## Summary

**What exists**: UI scaffolding (checkbox, placeholder page) and a helper function for chat instantiation.

**What doesn't exist**: Any backend logic to create sessions, maintain history, or call Gemini's chat API.

**Net effect**: Checking "Keep chat history (beta)" does nothing. All jobs are stateless single-shot generations.
