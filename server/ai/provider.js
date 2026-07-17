const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_TOKENS = 1024;

async function streamReply({ system, messages, onToken }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const stream = await ai.models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: MAX_TOKENS,
    },
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.text;
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }

  return full;
}

module.exports = { streamReply };
