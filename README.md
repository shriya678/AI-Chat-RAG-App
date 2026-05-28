# AI Chat RAG App

A real-time, multi-room chat application — built in three focused iterations.
This is **Iteration 1: the foundation layer** — authentication, persistent messaging, and real-time sockets.
The AI layer (Claude / Anthropic) and RAG layer (vector search + document context) come next.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 5 |
| Real-time | Socket.IO 4 |
| Database | MongoDB + Mongoose |
| Auth | JWT + bcryptjs |
| Frontend | Vanilla HTML / CSS / JS (no framework) |
| Dev tooling | nodemon |

---

## What's Built (Iteration 1)

- **User accounts** — register and login with email + password (bcrypt hashed, JWT issued)
- **Chat rooms** — create named rooms, join/leave at will
- **Real-time messaging** — Socket.IO broadcasts messages to all room members instantly
- **Message persistence** — every message is saved to MongoDB; history loads on room join
- **Cursor-based pagination** — message history fetches 30 messages at a time using a `before` timestamp
- **Typing indicators** — live "X is typing…" shown to other room members
- **Last-seen tracking** — user's `lastSeen` timestamp updated on disconnect (hooks into the future AI summarizer)
- **Socket authentication** — every socket connection is verified via JWT middleware before any event is processed

---

## Project Structure

```
AI-Chat-RAG-App/
├── server/
│   ├── index.js              # App entry point — Express + Socket.IO bootstrap
│   ├── config/
│   │   └── db.js             # MongoDB connection
│   ├── middleware/
│   │   └── auth.js           # JWT auth middleware for HTTP routes
│   ├── models/
│   │   ├── User.js           # username, email, passwordHash, lastSeen
│   │   ├── Room.js           # name, description, createdBy, members
│   │   └── Message.js        # roomId, userId, username, text, isAI
│   ├── routes/
│   │   ├── auth.js           # POST /api/auth/register  POST /api/auth/login
│   │   └── rooms.js          # GET/POST /api/rooms  GET /api/rooms/:id/messages
│   └── socket/
│       └── index.js          # All Socket.IO event handlers
├── public/
│   ├── index.html            # Single-page app shell (auth + chat screens)
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js           # Login / register UI logic
│       └── chat.js           # Room list, messaging, typing indicators
├── .env.example              # Environment variable template
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB running locally (or a MongoDB Atlas connection string)

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

# Phase 2 — add when building the AI layer
ANTHROPIC_API_KEY=
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

**Message history pagination:**
```
GET /api/rooms/:roomId/messages?before=<ISO timestamp>
```
Pass the `createdAt` of the oldest loaded message as `before` to fetch the previous page.

---

## Socket Events

Socket connections are authenticated via JWT passed in the handshake:
```js
const socket = io({ auth: { token } });
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ roomId }` | Join a room and start receiving its messages |
| `room:leave` | `{ roomId }` | Leave a room |
| `message:send` | `{ roomId, text }` | Send a message to a room |
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
| `isAI` | Boolean | `false` now; `true` for AI responses in Phase 2 |
| `createdAt` | Date | Compound index with `roomId` for efficient history queries |

---

## Roadmap

### Iteration 1 — Foundation (current)
- [x] JWT authentication
- [x] Multi-room real-time chat via Socket.IO
- [x] MongoDB message persistence
- [x] Cursor-based message history pagination
- [x] Typing indicators
- [x] `lastSeen` tracking (hook point for AI summarizer)
- [x] `isAI` flag on messages (ready for AI responses)

### Iteration 2 — AI Layer
- [ ] Integrate Anthropic Claude via `ANTHROPIC_API_KEY`
- [ ] `@ai` mention triggers AI response in the room
- [ ] AI pipeline hook in `socket/index.js` (stub already in place)
- [ ] Catch-up summary: on login, summarize messages since `lastSeen`
- [ ] Streaming AI responses via Socket.IO

### Iteration 3 — RAG Layer
- [ ] Document ingestion pipeline (PDF, markdown, text)
- [ ] Embedding generation and vector store (e.g. pgvector / Pinecone)
- [ ] Retrieval-augmented generation — AI answers grounded in your documents
- [ ] Per-room knowledge bases
- [ ] Source citations in AI responses
