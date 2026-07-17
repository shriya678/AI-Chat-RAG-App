const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-004';

async function embedTexts(texts) {
  const result = await ai.models.embedContent({
    model: MODEL,
    contents: texts,
  });
  return result.embeddings.map((e) => e.values);
}

async function embedText(text) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

module.exports = { embedText, embedTexts };
