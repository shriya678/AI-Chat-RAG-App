const express = require('express');
const Room = require('../models/Room');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/rooms - list all rooms
router.get('/', authMiddleware, async (req, res) => {
  const rooms = await Room.find().select('name description createdAt').lean();
  res.json(rooms);
});

// POST /api/rooms - create a room
router.post('/', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: 'Room name required' });

  const exists = await Room.findOne({ name });
  if (exists) return res.status(409).json({ message: 'Room name already taken' });

  const room = await Room.create({ name, description, createdBy: req.user.id });
  res.status(201).json(room);
});

// GET /api/rooms/:roomId/messages - fetch message history
router.get('/:roomId/messages', authMiddleware, async (req, res) => {
  const { before } = req.query; // cursor-based: messages before this timestamp
  const limit = 30;

  const query = { roomId: req.params.roomId };
  if (before) query.createdAt = { $lt: new Date(before) };

  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json(messages.reverse());
});

module.exports = router;
