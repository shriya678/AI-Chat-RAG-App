# Iteration 4 — Agentic RAG

## Context

Iteration 3 shipped a working RAG stack: users upload documents, the AI cites them when relevant. But under the hood the AI still behaves like a **stateless, one-shot Q&A machine**:

- Every `@ai` is treated in isolation — the AI has no memory of what was asked 30 seconds ago.
- Retrieval always fires whether documents are relevant or not (we then rely on prompt rules to tell the AI "ignore if irrelevant"). Wasteful tokens, imperfect signal.
- The AI's persona is hardcoded — the same "concise chat assistant" tone in every room.
- The AI's reasoning is invisible — users see the answer, not how it was reached.

Iteration 4 makes the AI feel like an actual **agent**: it remembers the conversation, decides for itself when to search documents, is customizable per room, and (optionally) shows its reasoning.

The primary goal for this iteration is **learning agentic AI patterns** — function calling, multi-turn context, LLM-driven decision making. The visible payoff is that the AI is genuinely smarter and more customizable.

---

## Design decisions (confirmed)

| Decision | Choice | Rationale |
|---|---|---|
| Conversation memory | **Include the last N AI+user turns as proper role-tagged messages** (default 6 = ~3 exchanges) | Users can follow up naturally ("what about the second point?") and the AI has context. Env var `AI_CONVERSATION_TURNS`. |
| Retrieval trigger | **Function calling** — AI decides when to call `search_documents(query)` tool | Replaces "always retrieve top-3" from Iteration 3. AI reasons "do I need docs for this?" Saves tokens, teaches the agentic pattern that underlies real production AI apps. |
| Persona storage | **New `systemPrompt` field on `Room` model** (optional; empty = default) | Room-level setting — a room's persona is fundamentally about the room. Owner-only edit. |
| Persona editing | **Modal accessible from the room header** | Non-intrusive; only opens on click. |
| Reasoning display | **Optional Chunk 4** — `gemini-2.5-pro` thinking blocks streamed to a collapsible UI element | Nice-to-have polish. Deferrable if function calling is enough learning for one iteration. |
| Provider | Continue with Gemini via `@google/genai`; may upgrade default model to `gemini-2.5-pro` for tool-use if `flash` proves flaky | Same SDK, same key — no new integrations. |

---

## Chunks (4 substantive + 1 polish)

### Chunk 1 — Multi-turn AI conversations

**Goal:** the AI remembers what was said earlier in the room and can respond to follow-ups coherently.

- Modify `server/ai/router.js`:
  - Instead of building one big transcript in a single user turn, map recent messages into a proper `messages: [{role, content}]` array — user messages → `role: 'user'`, AI messages → `role: 'assistant'`.
  - Take the last `AI_CONVERSATION_TURNS` (default 6) messages that are either from the triggering user OR from the AI. Skip other users' chatter (keeps context focused on the actual conversation).
  - Preserve the base system prompt.
- Add `AI_CONVERSATION_TURNS` to `.env.example` (default 6).
- No provider changes — `streamReply` already accepts a `messages` array.

**Testable:** ask `@ai what's 2+2?`, then `@ai now double it`. The second reply understands "it" refers to 4.

---

### Chunk 2 — Function calling: retrieval-as-tool

**Goal:** stop always-injecting excerpts. Instead, define a `search_documents(query)` tool. The AI decides whether to call it. If it does, run RAG, feed the results back, get the final reply.

- `server/ai/provider.js`: extend `streamReply` to accept an optional `tools` parameter and handle the two-turn tool-use flow — Gemini's response may be a tool call; if so, execute the tool callback, feed the result back into a second Gemini call, stream the final answer.
- `server/ai/router.js`:
  - Define the `search_documents` tool declaration.
  - When Gemini invokes it, call `retrieveContext({ roomId, query })` (existing function, already ships top-3 chunks + sources).
  - Return the chunks as the tool result; the second Gemini call formats the final reply with citations.
- **Important:** research Gemini's tool-use API shape via `@google/genai` docs before implementing. Verify version 2.12.0 supports it or upgrade if needed.

**Testable:**
- Ask `@ai what's 2+2?` → server logs show NO retrieval call. Reply arrives directly.
- Ask `@ai what animals purr?` (with test.txt uploaded) → server logs show ONE retrieval call. Reply cites `test.txt`.
- Compare to Iteration 3: retrieval happened on both questions but AI correctly ignored the irrelevant excerpts. Now retrieval only happens when needed.

---

### Chunk 3 — Per-room AI personas

**Goal:** each room can have its own AI personality/instructions. A "Legal Advisor" room, a "Cooking Buddy" room, whatever.

- `server/models/Room.js`: add optional `systemPrompt: String` field.
- `server/routes/rooms.js`: add `PATCH /api/rooms/:roomId` — updates the persona. Owner-only check (compare `req.user.id` to `room.createdBy`).
- `server/ai/router.js`: at the top of `handleMessage`, load the room, use `room.systemPrompt` if non-empty, else the default `SYSTEM_PROMPT`.
- `public/index.html`: add a small ⚙ button in the chat header (visible only for rooms the user created).
- `public/js/chat.js`: modal with a textarea prefilled with current persona; save via PATCH; on success, reload the room.
- `public/css/style.css`: modal styling.

**Testable:**
- Create a room, set persona to `"You are a grumpy pirate. Reply in pirate English."`
- Ask `@ai hello` → reply arrives in pirate voice.
- Non-owner: no ⚙ button visible.
- Empty persona = falls back to default (regression check).

---

### Chunk 4 — Streaming AI reasoning (OPTIONAL / experimental)

**Goal:** show the AI's step-by-step thinking in a collapsible UI element above the reply.

- Requires `gemini-2.5-pro` (or newer thinking-enabled model). Verify `@google/genai` v2.12.0 exposes the reasoning stream — may need SDK upgrade.
- New socket event `ai:thinking` carries reasoning tokens (separate stream from `ai:token`).
- `server/ai/provider.js`: parse reasoning parts from the stream, emit via a new callback (`onThinking(delta)`).
- `server/ai/router.js`: forward `onThinking` deltas as `ai:thinking` events.
- `public/js/chat.js`: on `ai:token`, business as usual. On `ai:thinking`, append to a separate `<details>` block ("Show reasoning") that lives above the AI bubble.
- `public/css/style.css`: muted, monospace style for the reasoning block.

**Decision point:** if function calling turns out to be a lot to absorb, defer this to Iteration 5. Flag it during implementation, not now.

**Testable:** ask any question. Above the AI reply, a "▶ Show reasoning" toggle appears; expanding it reveals the AI's thinking steps.

---

### Chunk 5 — README + roadmap update

**Goal:** keep the README honest.

- Update Iteration 4 section (was: none; becomes: complete or in-progress checklist).
- Add new socket events (`ai:thinking` if Chunk 4 shipped).
- Add new API endpoints (`PATCH /api/rooms/:roomId`).
- Add new env vars (`AI_CONVERSATION_TURNS`).
- Update roadmap.
- Regression check: run through all Iteration 1-3 flows.

---

## Files affected (summary)

| File | Chunks that touch it |
|---|---|
| `server/ai/router.js` | 1, 2, 3 |
| `server/ai/provider.js` | 2, 4 |
| `server/models/Room.js` | 3 |
| `server/routes/rooms.js` | 3 |
| `public/index.html` | 3 |
| `public/js/chat.js` | 3, 4 |
| `public/css/style.css` | 3, 4 |
| `.env.example` | 1, 4 |
| `README.md` | 5 |

Existing utilities to reuse:
- `retrieveContext({ roomId, query })` from `server/ai/rag.js` — Chunk 2 wraps this as the tool implementation.
- `streamReply({ system, messages, onToken })` from `server/ai/provider.js` — Chunk 2 extends its signature; Chunk 1 uses it unchanged.
- Existing `Message` history loading in `router.js` — Chunk 1 reshapes the mapping but keeps the query.
- `authMiddleware` — Chunk 3's PATCH endpoint uses it.

---

## Verification (once all shipped)

1. **Multi-turn:** `@ai remember I like blue`, then `@ai what's my favorite color?` — reply is "blue."
2. **Function calling on trivial questions:** `@ai what's 2+2?` — server logs show no retrieval call.
3. **Function calling on doc questions:** `@ai <question about uploaded doc>` — server logs show one retrieval call, reply cites the source.
4. **Persona:** create room with a persona, verify AI adopts it. Non-owner can't edit.
5. **Empty persona regression:** rooms without a persona use the default (Iteration 2/3 behavior preserved).
6. **Reasoning (if Chunk 4 shipped):** reasoning steps appear in a collapsible block above the reply.
7. **Regression:** upload/delete docs, plain chat, socket auth, session persist — all still work.

---

## Out of scope (deferred to a possible Iteration 5)

- **Atlas Vector Search** — still fine at hundreds of chunks; upgrade when we grow.
- **Hybrid search / reranking** — real production RAG uses cosine + BM25 + rerank. Big theme worth its own iteration.
- **Multimodal (images/voice)** — different theme; if picked next it becomes Iteration 5.
- **Document preview UI (Option B/C from Iteration 3 planning)** — mostly UI work; could bundle with a "polish" iteration.
- **Query rewriting** — considered but function calling + multi-turn cover most of the same benefit at less complexity.
- **Chunking upgrades** — paragraph-aware, semantic. Retrieval quality lever; separate iteration if wanted.
- **Non-owner room permissions** (roles/moderation) — bigger multi-user story.
