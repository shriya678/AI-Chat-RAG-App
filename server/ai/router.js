const Message = require('../models/Message');
const { streamReply } = require('./provider');
const { retrieveContext } = require('./rag');

const MENTION_REGEX = /@ai\b/i;
const COOLDOWN_MS = 5000;
const CONTEXT_MESSAGES = parseInt(process.env.AI_CONTEXT_MESSAGES, 10) || 20;

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
    const history = await Message.find({ roomId })
      .sort({ createdAt: -1 })
      .limit(CONTEXT_MESSAGES)
      .lean();

    const transcript = history
      .reverse()
      .map((m) => `[${m.isAI ? 'AI Assistant' : m.username}]: ${m.text}`)
      .join('\n');

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
      messages: [
        {
          role: 'user',
          content:
            `Recent chat transcript:\n\n${transcript}\n\n` +
            `Respond to the latest @ai message. Reply as "AI Assistant".`,
        },
      ],
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
