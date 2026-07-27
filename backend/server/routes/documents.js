const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');

const authMiddleware = require('../middleware/auth');
const DocumentChunk = require('../models/DocumentChunk');
const { ingestFile } = require('../ai/rag');

const router = express.Router();

const MAX_FILE_MB = parseInt(process.env.UPLOAD_MAX_FILE_MB, 10) || 5;

// Multer holds the file in memory as a Buffer — good for our size cap.
// For much larger files you'd stream to disk/S3 instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

// POST /api/rooms/:roomId/documents  — upload and ingest a document
router.post('/:roomId/documents', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  try {
    const { documentId, chunks } = await ingestFile({
      roomId: req.params.roomId,
      filename: req.file.originalname,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    res.status(201).json({
      documentId,
      title: req.file.originalname,
      chunks,
    });
  } catch (err) {
    console.error('[documents] ingest error:', err.message);
    res.status(500).json({ message: err.message || 'Ingestion failed' });
  }
});

// GET /api/rooms/:roomId/documents  — list documents in the room (one entry per uploaded file)
router.get('/:roomId/documents', authMiddleware, async (req, res) => {
  try {
    const roomId = new mongoose.Types.ObjectId(req.params.roomId);
    const docs = await DocumentChunk.aggregate([
      { $match: { roomId } },
      { $group: {
        _id: '$documentId',
        title: { $first: '$documentTitle' },
        chunks: { $sum: 1 },
        createdAt: { $min: '$createdAt' },
      } },
      { $sort: { createdAt: -1 } },
    ]);
    res.json(docs.map((d) => ({
      documentId: d._id,
      title: d.title,
      chunks: d.chunks,
      createdAt: d.createdAt,
    })));
  } catch (err) {
    console.error('[documents] list error:', err.message);
    res.status(500).json({ message: 'Failed to list documents' });
  }
});

// DELETE /api/rooms/:roomId/documents/:documentId  — remove all chunks of one uploaded file
router.delete('/:roomId/documents/:documentId', authMiddleware, async (req, res) => {
  try {
    const result = await DocumentChunk.deleteMany({
      roomId: req.params.roomId,
      documentId: req.params.documentId,
    });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error('[documents] delete error:', err.message);
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

module.exports = router;
