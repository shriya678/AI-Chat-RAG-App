const crypto = require('crypto');
// The vendored pdf-parse index.js has a debug block that tries to open a
// test PDF on module load and throws ENOENT in production installs. Requiring
// the underlying lib file directly bypasses it. Known workaround since 2020.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const DocumentChunk = require('../models/DocumentChunk');
const { embedTexts } = require('./embeddings');

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_CHARS, 10) || 500;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP_CHARS, 10) || 50;

async function ingestFile({ roomId, filename, buffer, mimetype }) {
  const rawText = await extractText({ buffer, mimetype, filename });
  const cleaned = rawText.replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    throw new Error('No text could be extracted from this file');
  }

  const chunks = chunkText(cleaned, CHUNK_SIZE, CHUNK_OVERLAP);
  const embeddings = await embedTexts(chunks);

  const documentId = crypto.randomUUID();
  const docs = chunks.map((text, i) => ({
    roomId,
    documentId,
    documentTitle: filename,
    chunkIndex: i,
    text,
    embedding: embeddings[i],
  }));

  await DocumentChunk.insertMany(docs);

  return { documentId, chunks: chunks.length };
}

async function extractText({ buffer, mimetype, filename }) {
  const isPdf = mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const result = await pdfParse(buffer);
    return result.text;
  }
  // text/plain, text/markdown, and any file we treat as UTF-8 text
  return buffer.toString('utf-8');
}

function chunkText(text, size, overlap) {
  if (overlap >= size) {
    throw new Error('CHUNK_OVERLAP_CHARS must be less than CHUNK_SIZE_CHARS');
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

module.exports = { ingestFile };
