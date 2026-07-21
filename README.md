# AI Chat RAG App

A real-time, multi-room chat application with an AI participant that can answer questions grounded in your uploaded documents.

Built in three focused iterations:
1. **Foundation** — real-time chat, auth, persistence.
2. **AI layer** — `@ai` mentions get streaming replies from Google Gemini.
3. **RAG layer** — per-room document knowledge base; the AI cites its sources.

Deployed on Render + MongoDB Atlas + Gemini free tier at **$0/month**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Real-time | Socket.IO 4 |
| Database | MongoDB + Mongoose (Atlas M0 in prod) |
| Auth | JWT + bcryptjs |
| AI provider | Google Gemini via `@google/genai` (chat + embeddings) |
| PDF text extraction | `pdf-parse` v2 |
| File uploads | `multer` |
| Frontend | Vanilla HTML / CSS / JS (no framework) |
| Dev tooling | nodemon |
| Hosting | Render.com (free tier) |

---

## Features

### Iteration 1 — Foundation ✅
- Register / login with email + password (bcrypt + JWT).
- Create rooms, join / leave freely.
- Real-time messaging via Socket.IO with typing indicators.
- Message persistence in MongoDB, history loads on room join.
- Cursor-based history pagination (`before` timestamp).
- Socket authentication with DB-backed user validation (rejects stale JWTs).
- Session persists across page refresh; active room restored on reload.

### Iteration 2 — AI Layer ✅
- Any message containing `@ai` triggers a reply from **Google Gemini** (`gemini-2.5-flash` by default).
- Replies **stream token-by-token** into the chat via Socket.IO.
- Per-user 5-second cooldown to prevent runaway costs.
- AI-authored messages saved to MongoDB with `isAI: true`.
- Provider is behind a `provider.js` adapter — swapping to Claude / Ollama / other is a one-file change.

### Iteration 3 — RAG Layer ✅
- Upload PDF, TXT, or MD files to a room as a knowledge base.
- On upload: text extracted, split into overlapping 500-char chunks, embedded via `gemini-embedding-001`, stored in MongoDB.
- On `@ai` query: question is embedded, cosine-similarity against room chunks, top-3 relevant excerpts injected into the prompt.
- Model cites sources at the end of the reply when it uses retrieved content (`Sources: file.pdf`).
- Empty-room queries behave exactly as in Iteration 2 (no forced retrieval).
- Documents can be deleted from the sidebar — removes all chunks for that upload.

---

## Project Structure

```
AI-Chat-RAG-App/
├── server/
│   ├── index.js              # App entry — Express + Socket.IO + route mounting
│   ├── config/
│   │   └── db.js             # MongoDB connection
│   ├── middleware/
│   │   └── auth.js           # JWT auth middleware for HTTP routes
│   ├── models/
│   │   ├── User.js           # username, email, passwordHash, lastSeen
│   │   ├── Room.js           # name, description, createdBy, members
│   │   ├── Message.js        # roomId, userId, username, text, isAI
│   │   └── DocumentChunk.js  # roomId, documentId, title, chunkIndex, text, embedding
│   ├── routes/
│   │   ├── auth.js           # POST /api/auth/register  POST /api/auth/login
│   │   ├── rooms.js          # GET/POST /api/rooms  GET /api/rooms/:id/messages
│   │   └── documents.js      # POST/GET /api/rooms/:id/documents  (upload, list)
│   ├── socket/
│   │   └── index.js          # All Socket.IO event handlers + DB-backed JWT auth
│   └── ai/
│       ├── provider.js       # Gemini adapter — streamReply(system, messages, onToken)
│       ├── embeddings.js     # Gemini text-to-vector adapter
│       ├── router.js         # @ai orchestrator: mention detect, RAG retrieve, stream
│       └── rag.js            # ingestFile + retrieveContext + cosine similarity
├── public/
│   ├── index.html            # Single-page app shell (auth + chat screens)
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js           # Login / register + session-persist-on-refresh
│       ├── chat.js           # Rooms, messaging, AI streaming, active-room persist
│       └── documents.js      # Upload / list per-room documents
├── .env.example              # Environment variable template
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (free tier)

### Install

```bash
git clone <repo-url>
cd AI-Chat-RAG-App
npm install
```

### Configure environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/chatapp
JWT_SECRET=replace_with_a_long_random_secret

# AI layer (Iteration 2) - Google Gemini
GOOGLE_API_KEY=<your Gemini API key>
GEMINI_MODEL=gemini-2.5-flash
AI_CONTEXT_MESSAGES=20

# RAG layer (Iteration 3)
EMBEDDING_MODEL=gemini-embedding-001
CHUNK_SIZE_CHARS=500
CHUNK_OVERLAP_CHARS=50
UPLOAD_MAX_FILE_MB=5
RAG_TOP_K=3
```

### Run

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## API Reference

All protected routes require the header:
```
Authorization: Bearer <jwt_token>
```

### Auth

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{ username, email, password }` | Create account, returns token |
| `POST` | `/api/auth/login` | `{ email, password }` | Login, returns token |

### Rooms

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rooms` | List all rooms |
| `POST` | `/api/rooms` | Create a room `{ name, description }` |
| `GET` | `/api/rooms/:roomId/messages` | Fetch message history (30 per page) |

Pagination: `GET /api/rooms/:roomId/messages?before=<ISO timestamp>` — pass the `createdAt` of the oldest loaded message.

### Documents (Iteration 3)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/rooms/:roomId/documents` | Upload a document (multipart `file` field). Server extracts text, chunks, embeds, stores. Returns `{ documentId, title, chunks }`. |
| `GET` | `/api/rooms/:roomId/documents` | List documents in the room. Returns `[{ documentId, title, chunks, createdAt }]`. |
| `DELETE` | `/api/rooms/:roomId/documents/:documentId` | Remove all chunks belonging to one uploaded file. Returns `{ deleted: <chunkCount> }`. |

Supported formats: PDF, plain text, markdown. Max file size: 5 MB (configurable via `UPLOAD_MAX_FILE_MB`).

---

## Socket Events

Socket connections are authenticated via JWT passed in the handshake **and** validated against the user record in MongoDB (stale JWTs are rejected):

```js
const socket = io({ auth: { token } });
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ roomId }` | Join a room and receive its messages |
| `room:leave` | `{ roomId }` | Leave a room |
| `message:send` | `{ roomId, text }` | Send a message (triggers AI pipeline if `@ai` is present) |
| `typing:start` | `{ roomId }` | Notify others you started typing |
| `typing:stop` | `{ roomId }` | Notify others you stopped typing |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room:user_joined` | `{ username, timestamp }` | Someone joined your current room |
| `room:user_left` | `{ username, timestamp }` | Someone left your current room |
| `message:new` | `{ _id, username, text, isAI, createdAt }` | New message broadcast to the room |
| `typing:start` | `{ username }` | A user started typing |
| `typing:stop` | `{ username }` | A user stopped typing |
| `ai:typing` | *(no payload)* | AI has received an `@ai` mention and started processing |
| `ai:token` | `{ roomId, delta }` | Incremental text chunk from the streaming AI reply |
| `ai:done` | `{ _id, username, text, isAI, createdAt }` | AI reply is complete and persisted |
| `ai:error` | `{ message }` | AI request failed (sanitized error message) |

---

## Data Models

### User
| Field | Type | Notes |
|---|---|---|
| `username` | String | Unique, 2–30 chars |
| `email` | String | Unique, lowercased |
| `passwordHash` | String | bcrypt hashed on save |
| `lastSeen` | Date | Updated on socket disconnect |
| `createdAt` | Date | Auto |

### Room
| Field | Type | Notes |
|---|---|---|
| `name` | String | Unique |
| `description` | String | Optional |
| `createdBy` | ObjectId → User | |
| `members` | [ObjectId → User] | |

### Message
| Field | Type | Notes |
|---|---|---|
| `roomId` | ObjectId → Room | Indexed |
| `userId` | ObjectId → User | |
| `username` | String | Denormalized for fast reads |
| `text` | String | Max 2000 chars |
| `isAI` | Boolean | `true` for AI-authored replies |
| `createdAt` | Date | Compound index with `roomId` for efficient history queries |

### DocumentChunk (Iteration 3)
| Field | Type | Notes |
|---|---|---|
| `roomId` | ObjectId → Room | Indexed |
| `documentId` | String | UUID — groups all chunks from one upload |
| `documentTitle` | String | Original filename (denormalized for fast listing) |
| `chunkIndex` | Number | Ordering within the document |
| `text` | String | The chunk's text content (≤ ~500 chars) |
| `embedding` | [Number] | The vector fingerprint (3072 dims for `gemini-embedding-001`) |
| `createdAt` | Date | Auto |

Compound index on `{ roomId, documentId }` covers both per-room scans and per-document deletes.

---

## Roadmap

### Iteration 1 — Foundation ✅
- [x] JWT authentication (with DB-backed socket validation)
- [x] Multi-room real-time chat via Socket.IO
- [x] MongoDB message persistence
- [x] Cursor-based message history pagination
- [x] Typing indicators
- [x] Session + active-room persistence across page refresh

### Iteration 2 — AI Layer ✅
- [x] Google Gemini integration via `GOOGLE_API_KEY`
- [x] `@ai` mention triggers AI response in the room
- [x] Per-user cooldown to prevent cost blowouts
- [x] Streaming AI responses via Socket.IO (`ai:token` / `ai:done`)
- [x] Provider adapter pattern (`server/ai/provider.js`) — swappable
- [ ] Catch-up summary: on login, summarize messages since `lastSeen` *(deferred)*

### Iteration 3 — RAG Layer ✅
- [x] Document ingestion pipeline (PDF via `pdf-parse`, TXT/MD as UTF-8)
- [x] Chunking (500 chars, 50 overlap; configurable)
- [x] Embedding generation via `gemini-embedding-001`
- [x] Vector storage in MongoDB (chunks + embeddings)
- [x] Retrieval-augmented generation with cosine similarity in Node
- [x] Per-room knowledge bases
- [x] Source citations in AI responses (model-driven)
- [x] Upload UI in sidebar
- [x] Document delete UI + endpoint
- [ ] Atlas Vector Search index *(future — deferred while chunk counts stay small)*
