# Iteration 2 — AI Layer

## Context

Iteration 1 (the current state) delivered a real-time multi-room chat with JWT auth, MongoDB persistence, Socket.IO messaging, typing indicators, and cursor-based history. The scaffolding for the AI layer is already in place — the `Message.isAI` flag, `.env.example` has `ANTHROPIC_API_KEY`, a stub in [server/socket/index.js:65-66](AI-Chat-RAG-App/server/socket/index.js#L65-L66) marks where the AI pipeline hook goes, and [public/js/chat.js:46-50](AI-Chat-RAG-App/public/js/chat.js#L46-L50) has stub listeners for `ai:token` / `ai:done`.

**Goal:** wire a local Ollama model (`llama3.1:8b`) into the chat so any message containing `@ai` triggers a streaming AI reply, broadcast to everyone in the room via Socket.IO. The provider is behind an adapter (`server/ai/provider.js`) so swapping to Claude, Gemini, or another provider later is a one-file change. The catch-up summary (originally listed in the README roadmap) is **deferred to Iteration 3** to keep this iteration focused on the AI response path.

**Why it matters:** this is the transition from a plain chat app to an AI-enabled chat app — the foundation that Iteration 3 (RAG) will build on top of.

---

## Design decisions (confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| Provider | **Ollama (local)** with `llama3.1:8b` | Zero cost, runs on the dev's own machine (16GB+ RAM). Trade some reply quality for free unlimited testing during learning. Swappable — `provider.js` is an adapter. |
| Trigger | `@ai` mention (case-insensitive) | Matches README roadmap; predictable cost; no surprise AI responses. |
| Streaming | Yes, via Socket.IO `ai:token` / `ai:done` events | Frontend stubs already sketched; snappier UX. |
| Context window | Last 20 room messages | Enough for coherent short chats without blowing tokens. Tunable via env var. |
| Catch-up summary | **Deferred to Iteration 3** | `lastSeen` field stays in place unchanged, ready for later. |

---

## Changes overview

### New files

- **[AI-Chat-RAG-App/server/ai/provider.js](AI-Chat-RAG-App/server/ai/provider.js)** — thin adapter around the Ollama SDK. Exports a single `streamReply({ system, messages, onToken })` function that calls `client.chat({...})` with `stream: true`, iterates the async iterator, invokes `onToken(delta)` for each `part.message.content` chunk, and returns the full concatenated text. Uses `llama3.1:8b`, `num_predict: 1024`. Model + host read from env with sensible defaults. **Interface is provider-agnostic** — the same function signature works if we later swap to Claude, Gemini, or Groq; only this file changes.
- **[AI-Chat-RAG-App/server/ai/router.js](AI-Chat-RAG-App/server/ai/router.js)** — exports `handleMessage(io, socket, roomId, message)`. Responsibilities:
  1. Detect `@ai` (case-insensitive regex `/@ai\b/i`) in `message.text`. Return early if absent.
  2. Per-user cooldown check (in-memory `Map<userId, timestamp>`, 5-second window) to prevent runaway bills from mention spam. On cooldown, silently no-op.
  3. Load the last 20 messages in the room (including the triggering one) from MongoDB.
  4. Build the Anthropic request:
     - `system`: a short prompt describing the room and that the assistant is `@ai` in a group chat with named humans.
     - `messages`: single user turn containing formatted recent history as text, with the triggering `@ai` message highlighted at the end.
  5. Emit `ai:typing` to the room so users see the AI is "thinking".
  6. Call `streamReply()`. In the `onToken` callback, emit `ai:token { roomId, delta }` to everyone in the room.
  7. On completion: create a `Message` doc with `isAI: true`, `username: 'AI Assistant'`, then emit `ai:done { _id, text, createdAt }` and `message:new` (for clients that missed the streaming events, e.g. late joiners loading history).
  8. On error: log server-side, emit `ai:error { message: 'AI request failed' }` (no leaking API details).

### Files to modify

- **[AI-Chat-RAG-App/server/socket/index.js](AI-Chat-RAG-App/server/socket/index.js)** — inside the `message:send` handler at line 65-66, replace the stub comment with `aiRouter.handleMessage(io, socket, roomId, message).catch(err => console.error('AI router error:', err))`. Fire-and-forget — do not `await` (would block other messages).
- **[AI-Chat-RAG-App/public/js/chat.js](AI-Chat-RAG-App/public/js/chat.js)** — replace the stub block at line 46-50 with real handlers:
  - `ai:typing` → show a persistent "AI Assistant is typing…" indicator (reuse the existing typing-indicator CSS if possible).
  - `ai:token { delta }` → append `delta` to a streaming AI message bubble. If no bubble exists yet, create one with `msg.isAI = true` styling. Reuse `appendMessage()` structure but keep a reference to the current streaming bubble.
  - `ai:done { _id, text, createdAt }` → finalize the streaming bubble (assign `_id`, hide typing indicator).
  - `ai:error { message }` → append a system-style error line and hide the typing indicator.
- **[AI-Chat-RAG-App/package.json](AI-Chat-RAG-App/package.json)** — add `"@anthropic-ai/sdk": "^0.30.0"` (or latest 0.x) to dependencies. Run `npm install`.
- **[AI-Chat-RAG-App/.env.example](AI-Chat-RAG-App/.env.example)** — already has `ANTHROPIC_API_KEY=`. Add two optional lines below it:
  ```
  # AI layer (Iteration 2)
  ANTHROPIC_MODEL=claude-haiku-4-5
  AI_CONTEXT_MESSAGES=20
  ```

### Files NOT touched

- `server/models/Message.js` — `isAI` flag already exists, no schema change.
- `server/models/User.js` — `lastSeen` stays untouched; used in Iteration 3.
- `server/routes/*.js` — no new REST endpoints needed; everything flows through the existing socket.
- `server/config/db.js`, `server/middleware/auth.js` — untouched.

---

## Anthropic integration details

- **SDK client:** `new Anthropic()` with no args — SDK reads `ANTHROPIC_API_KEY` from env.
- **API call shape:**
  ```js
  const stream = client.messages.stream({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: HISTORY_AS_TEXT }],
  });
  for await (const delta of stream.text_stream) { onToken(delta); }
  const final = await stream.finalMessage();
  ```
- **System prompt** (roughly): "You are an AI assistant participating in a group chat room. Users can mention you with `@ai` to ask questions. Reply concisely and directly — you're in a chat, not writing an essay. Do not include a preamble."
- **History format** (single user turn): each prior message as `[<username>]: <text>` on its own line, then the current `@ai` message. This keeps things simple; a more sophisticated role-mapping (assistant messages from past AI replies → `role: 'assistant'`) can come later if quality suffers.
- **No `thinking`, no `tools` for now.** Haiku 4.5 does not support extended thinking. Keep it simple.

---

## Verification

Follow-up work to run after implementation:

1. **Startup smoke test:** `cd AI-Chat-RAG-App && npm install && npm run dev`. Server should boot without errors, MongoDB connects, static files serve at `http://localhost:3000`.
2. **Auth + room flow (regression):** register two users in two browser tabs, both join the same room, exchange a few plain messages. Verify no regressions from Iteration 1 — messages persist, typing indicators work, history loads.
3. **Golden path — @ai reply:**
   - In one tab, send `hey @ai, what's 2+2?`.
   - Verify: the sender sees their own message immediately; both tabs see an "AI Assistant is typing…" indicator; tokens stream into a new AI-styled bubble in both tabs; the bubble persists after streaming ends; refreshing the page and re-joining the room shows the AI message loaded from history (via `GET /api/rooms/:roomId/messages`, since it's stored with `isAI: true`).
4. **No trigger — plain message:** send `hello world` (no `@ai`). Verify no AI response, no wasted API call (log line only prints when `@ai` matches).
5. **Cooldown:** send `@ai one`, then immediately `@ai two`. First triggers a reply; second is silently dropped (server log shows cooldown skip). Wait 5s, send `@ai three` → replies again.
6. **Error path:** temporarily set `ANTHROPIC_API_KEY=bad` in `.env`, restart, send `@ai test`. Verify the client sees `ai:error` and shows a friendly message; server logs the real error.
7. **Bill sanity:** open the Anthropic Console → Usage. Confirm a single test session consumes < $0.01 (Haiku 4.5 at 20-message context is tiny).

---

## Out of scope (deferred)

- **Catch-up summary on login** — moved to Iteration 3.
- **Multiple concurrent `@ai` mentions in one message** — handled naturally (one AI reply per `message:send` that matches).
- **Rate limits beyond the 5s per-user cooldown** — no global rate limiting; fine for a demo/dev app.
- **Persisting the streaming partial in DB** — only the final complete message is saved. If the server crashes mid-stream, the partial is lost.
- **Tool use, RAG, document upload** — all Iteration 3.
