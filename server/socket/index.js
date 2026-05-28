const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const User = require('../models/User');

function initSocket(io) {
  // authenticate every socket connection via token
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.username} (${socket.id})`);

    // ── join a room ──────────────────────────────────────────
    socket.on('room:join', async ({ roomId }) => {
      socket.join(roomId);
      socket.currentRoom = roomId;

      // notify others in the room
      socket.to(roomId).emit('room:user_joined', {
        username: socket.user.username,
        timestamp: new Date(),
      });

      console.log(`${socket.user.username} joined room ${roomId}`);
    });

    // ── leave a room ─────────────────────────────────────────
    socket.on('room:leave', ({ roomId }) => {
      socket.leave(roomId);
      socket.to(roomId).emit('room:user_left', {
        username: socket.user.username,
        timestamp: new Date(),
      });
    });

    // ── send a message ───────────────────────────────────────
    socket.on('message:send', async ({ roomId, text }) => {
      if (!text?.trim() || !roomId) return;

      const message = await Message.create({
        roomId,
        userId: socket.user.id,
        username: socket.user.username,
        text: text.trim(),
      });

      // broadcast to everyone in the room (including sender)
      io.to(roomId).emit('message:new', {
        _id: message._id,
        username: message.username,
        text: message.text,
        isAI: false,
        createdAt: message.createdAt,
      });

      // Phase 2: AI pipeline hook goes here
      // await aiRouter(io, socket, roomId, message);
    });

    // ── typing indicators ────────────────────────────────────
    socket.on('typing:start', ({ roomId }) => {
      socket.to(roomId).emit('typing:start', { username: socket.user.username });
    });

    socket.on('typing:stop', ({ roomId }) => {
      socket.to(roomId).emit('typing:stop', { username: socket.user.username });
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on('disconnect', async () => {
      // update lastSeen so the summarizer knows what to summarize on next login
      await User.findByIdAndUpdate(socket.user.id, { lastSeen: new Date() });
      console.log(`User disconnected: ${socket.user.username}`);
    });
  });
}

module.exports = initSocket;
