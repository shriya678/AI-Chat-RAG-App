const mongoose = require('mongoose');

const documentChunkSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true,
  },
  documentId: {
    type: String,
    required: true,
  },
  documentTitle: {
    type: String,
    required: true,
  },
  chunkIndex: {
    type: Number,
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  embedding: {
    type: [Number],
    required: true,
  },
}, { timestamps: true });

// Two query patterns this collection has to serve fast:
// 1. retrieveContext(): load every chunk in a room     → roomId lookup
// 2. deleteDocument(): remove all chunks of one upload → (roomId, documentId) lookup
// The compound index covers both since MongoDB can use a prefix of a compound index.
documentChunkSchema.index({ roomId: 1, documentId: 1 });

module.exports = mongoose.model('DocumentChunk', documentChunkSchema);
