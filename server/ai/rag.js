const crypto = require('crypto');
// pdf-parse v2 is a full rewrite around pdfjs-dist and exposes a PDFParse
// class (v1 exported a function). No test-file debug bug in v2, so we
// require the package normally.
const { PDFParse } = require('pdf-parse');

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
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
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
