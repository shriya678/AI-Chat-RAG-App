const Message = require('../models/Message');
const { streamReply } = require('./provider');

const MENTION_REGEX = /@ai\b/i;
const COOLDOWN_MS = 5000;
const CONTEXT_MESSAGES = parseInt(process.env.AI_CONTEXT_MESSAGES, 10) || 20;

const SYSTEM_PROMPT = `You are an AI assistant participating in a group chat room.
Users mention you with "@ai" to ask questions or make requests.
Reply concisely and directly — you're in a chat, not writing an essay.
Do not include a preamble like "Sure!" or "I'd be happy to help!" — just answer.
If a question is ambiguous, ask one short clarifying question.`;

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

    io.to(roomId).emit('ai:typing');

    const reply = await streamReply({
      system: SYSTEM_PROMPT,
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
