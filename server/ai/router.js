const Message = require('../models/Message');
const { streamReply } = require('./provider');
const { retrieveContext } = require('./rag');

const MENTION_REGEX = /@ai\b/i;
const COOLDOWN_MS = 5000;
// How many prior turns (user + AI, from THIS user only) to send as
// conversation context. 6 ≈ 3 full exchanges, tunable via env.
const CONVERSATION_TURNS = parseInt(process.env.AI_CONVERSATION_TURNS, 10) || 6;

const SYSTEM_PROMPT = `You are an AI assistant participating in a group chat room.
Users mention you with "@ai" to ask questions or make requests.
Reply concisely and directly — you're in a chat, not writing an essay.
Do not include a preamble like "Sure!" or "I'd be happy to help!" — just answer.
If a question is ambiguous, ask one short clarifying question.`;

function buildRagSystemPrompt(chunks) {
  const excerpts = chunks
    .map((c) => `[source: ${c.source}]\n${c.text}`)
    .join('\n\n');
  return `${SYSTEM_PROMPT}

The following excerpts from the room's uploaded documents may be relevant to the current question. Each excerpt is labeled with its source file.

${excerpts}

Rules for using the excerpts:
- If your answer draws on the excerpts, end your reply with a line: "Sources: <comma-separated unique filenames>"
- If the excerpts aren't relevant to the question, ignore them and don't include a Sources line.
- Never invent quotations or facts; if the excerpts don't contain the answer, say so.`;
}

const cooldowns = new Map();

async function handleMessage(io, socket, roomId, triggerMessage) {
  if (!MENTION_REGEX.test(triggerMessage.text)) return;

  const userId = String(socket.user.id);
  const now = Date.now();
  const lastCall = cooldowns.get(userId) || 0;
  if (now - lastCall < COOLDOWN_MS) {
    console.log(`[AI router] cooldown skip for ${socket.user.username}`);
    return;
  }
  cooldowns.set(userId, now);

  try {
    // Load recent conversation between THIS user and the AI in this room.
    // We deliberately skip other users' messages so the AI sees a clean
    // 1-on-1 thread instead of jumbled group chatter.
    const history = await Message.find({
      roomId,
      $or: [{ isAI: true }, { userId: socket.user.id }],
    })
      .sort({ createdAt: -1 })
      .limit(CONVERSATION_TURNS)
      .lean();

    // Map to role-tagged turns Gemini can consume as a real conversation.
    // The last item is the triggering @ai message; older items are context.
    const messages = history
      .reverse()
      .map((m) => ({
        role: m.isAI ? 'assistant' : 'user',
        content: m.text,
      }));

    // Guard: a conversation sent to the model must start with a user turn.
    // If our window happens to open with an assistant message, drop it.
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    // Try to pull relevant document excerpts from the room's knowledge base.
    // If retrieval fails (e.g. embedding API down), fall through to a non-RAG
    // reply rather than failing the whole @ai turn.
    let ragChunks = [];
    try {
      const result = await retrieveContext({ roomId, query: triggerMessage.text });
      ragChunks = result.chunks;
    } catch (err) {
      console.warn('[AI router] RAG retrieval failed, continuing without context:', err.message);
    }

    const systemPrompt = ragChunks.length > 0
      ? buildRagSystemPrompt(ragChunks)
      : SYSTEM_PROMPT;

    io.to(roomId).emit('ai:typing');

    const reply = await streamReply({
      system: systemPrompt,
      messages,
      onToken: (delta) => {
        io.to(roomId).emit('ai:token', { roomId, delta });
      },
    });

    const aiMessage = await Message.create({
      roomId,
      userId: socket.user.id,
      username: 'AI Assistant',
      text: reply,
      isAI: true,
    });

    io.to(roomId).emit('ai:done', {
      _id: aiMessage._id,
      username: aiMessage.username,
      text: aiMessage.text,
      isAI: true,
      createdAt: aiMessage.createdAt,
    });
  } catch (err) {
    console.error('[AI router] error:', err.message);
    io.to(roomId).emit('ai:error', { message: 'AI request failed' });
  }
}

module.exports = { handleMessage };
