const { Ollama } = require('ollama');

const client = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
});

const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const MAX_TOKENS = 1024;

async function streamReply({ system, messages, onToken }) {
  const stream = await client.chat({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      ...messages,
    ],
    stream: true,
    options: { num_predict: MAX_TOKENS },
  });

  let full = '';
  for await (const part of stream) {
    const delta = part.message.content;
    full += delta;
    onToken(delta);
  }

  return full;
}

module.exports = { streamReply };
