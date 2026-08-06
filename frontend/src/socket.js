import { io } from 'socket.io-client';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// The backend's io.use() middleware reads socket.handshake.auth.token.
// Pass the token here (once, on connection) — every subsequent event is
// trusted because it flows through this authenticated socket.
export function createSocket(token) {
  return io(BASE_URL, {
    auth: { token },
    withCredentials: true,
  });
}
