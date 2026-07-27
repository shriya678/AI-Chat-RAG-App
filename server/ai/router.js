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
If a question is ambiguous, ask one short clarifying question.

You have access to a search_documents tool that searches the room's uploaded
documents. Call it ONLY when:
  - The user asks about specific facts, policies, procedures, names, or
    content that could reasonably live in an uploaded document, AND
  - General knowledge alone is unlikely to give a complete or accurate answer.

Do NOT call it for:
  - Greetings, small talk, math, general-knowledge questions
  - Follow-ups already grounded in earlier turns of this conversation
  - Anything the user is clearly asking as an opinion or preference

When your final answer draws on content returned by search_documents, end
your reply with exactly this line:
  Sources: <comma-separated unique filenames>
When you didn't use documents, do not include a Sources line.

Never invent facts or quotations. If the documents don't contain the answer,
say so plainly.`;

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

    // The search_documents tool is closed over the current roomId so the
    // model can pass just a query — it doesn't need to know about rooms.
    const searchDocumentsTool = {
      declaration: {
        name: 'search_documents',
        description:
          "Search the room's uploaded documents for content relevant to a question. " +
          'Returns up to a few short excerpts, each tagged with its source filename. ' +
          'Returns an empty list if no documents are uploaded or nothing matches.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'A natural-language search query. Rephrase the user question if that helps retrieval.',
            },
          },
          required: ['query'],
        },
      },
      execute: async ({ query }) => {
        try {
          const result = await retrieveContext({ roomId, query });
          if (!result.chunks.length) {
            return {
              excerpts: [],
              note: 'No documents in this room or no relevant content found.',
            };
          }
          return {
            excerpts: result.chunks.map((c) => ({
              source: c.source,
              text: c.text,
            })),
          };
        } catch (err) {
          console.warn('[AI router] search_documents error:', err.message);
          return { error: 'Search failed', excerpts: [] };
        }
      },
    };

    io.to(roomId).emit('ai:typing');

    const reply = await streamReply({
      system: SYSTEM_PROMPT,
      messages,
      tools: [searchDocumentsTool],
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
