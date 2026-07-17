let socket = null;
let activeRoomId = null;
const token = () => sessionStorage.getItem('token');
const username = () => sessionStorage.getItem('username');

window.startChat = function () {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');
  document.getElementById('current-username').textContent = username();

  socket = io({ auth: { token: token() } });
  bindSocketEvents();
  loadRooms();
};

// ── socket events ──────────────────────────────────────────
function bindSocketEvents() {
  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    // If the server rejected us for an auth-shaped reason, our stored token
    // is useless. Wipe it and reload back to the login screen instead of
    // sitting on an empty chat with no explanation.
    const AUTH_ERRORS = ['Authentication required', 'Invalid token', 'User no longer exists'];
    if (AUTH_ERRORS.includes(err.message)) {
      sessionStorage.clear();
      window.location.reload();
    }
  });

  socket.on('message:new', (msg) => {
    appendMessage(msg);
  });

  socket.on('room:user_joined', ({ username: u }) => {
    appendSystem(`${u} joined the room`);
  });

  socket.on('room:user_left', ({ username: u }) => {
    appendSystem(`${u} left the room`);
  });

  // typing indicators
  let typingTimeout;
  socket.on('typing:start', ({ username: u }) => {
    const el = document.getElementById('typing-indicator');
    el.textContent = `${u} is typing...`;
    el.classList.remove('hidden');
  });

  socket.on('typing:stop', () => {
    document.getElementById('typing-indicator').classList.add('hidden');
  });

  // AI streaming events (Iteration 2)
  socket.on('ai:typing', () => {
    const el = document.getElementById('typing-indicator');
    el.textContent = 'AI Assistant is typing...';
    el.classList.remove('hidden');
  });

  socket.on('ai:token', ({ delta }) => {
    let wrapper = document.getElementById('ai-streaming-bubble');
    if (!wrapper) wrapper = createStreamingBubble();
    const bubble = wrapper.querySelector('.message-bubble');
    bubble.textContent = (bubble.textContent || '') + delta;
    scrollToBottom();
  });

  socket.on('ai:done', (msg) => {
    const wrapper = document.getElementById('ai-streaming-bubble');
    if (wrapper) {
      wrapper.querySelector('.message-bubble').textContent = msg.text;
      wrapper.removeAttribute('id');
      wrapper.dataset.messageId = msg._id;
    } else {
      appendMessage(msg);
    }
    document.getElementById('typing-indicator').classList.add('hidden');
  });

  socket.on('ai:error', ({ message }) => {
    const wrapper = document.getElementById('ai-streaming-bubble');
    if (wrapper) wrapper.remove();
    appendSystem(`AI error: ${message}`);
    document.getElementById('typing-indicator').classList.add('hidden');
  });
}

function createStreamingBubble() {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.id = 'ai-streaming-bubble';
  div.classList.add('message', 'ai');

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = 'AI Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  div.appendChild(meta);
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
  return div;
}

// ── rooms ──────────────────────────────────────────────────
async function loadRooms() {
  const res = await fetch('/api/rooms', {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const rooms = await res.json();
  const list = document.getElementById('room-list');
  list.innerHTML = '';
  rooms.forEach(addRoomToList);
}

function addRoomToList(room) {
  const list = document.getElementById('room-list');
  const li = document.createElement('li');
  li.textContent = `# ${room.name}`;
  li.dataset.id = room._id;
  li.addEventListener('click', () => joinRoom(room));
  list.appendChild(li);
}

async function joinRoom(room) {
  if (activeRoomId === room._id) return;

  // leave old room
  if (activeRoomId) socket.emit('room:leave', { roomId: activeRoomId });

  activeRoomId = room._id;

  document.querySelectorAll('#room-list li').forEach(li => li.classList.remove('active'));
  document.querySelector(`#room-list li[data-id="${room._id}"]`).classList.add('active');
  document.getElementById('active-room-name').textContent = `# ${room.name}`;
  document.getElementById('messages').innerHTML = '';

  // enable input
  document.getElementById('message-input').disabled = false;
  document.getElementById('send-btn').disabled = false;

  socket.emit('room:join', { roomId: room._id });

  // load history
  const res = await fetch(`/api/rooms/${room._id}/messages`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const history = await res.json();
  history.forEach(appendMessage);
  scrollToBottom();
}

document.getElementById('create-room-btn').addEventListener('click', async () => {
  const name = prompt('Room name:');
  if (!name?.trim()) return;

  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: JSON.stringify({ name: name.trim() }),
  });
  const room = await res.json();
  if (res.ok) addRoomToList(room);
  else alert(room.message);
});

// ── messages ───────────────────────────────────────────────
function appendMessage(msg) {
  const container = document.getElementById('messages');
  const isOwn = msg.username === username();

  const div = document.createElement('div');
  div.classList.add('message');
  if (msg.isAI) div.classList.add('ai');
  else if (isOwn) div.classList.add('own');
  else div.classList.add('other');

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = msg.isAI ? 'AI Assistant' : msg.username;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = msg.text;

  div.appendChild(meta);
  div.appendChild(bubble);
  container.appendChild(div);
  scrollToBottom();
}

function appendSystem(text) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;color:var(--text-muted);font-size:0.8rem;padding:0.25rem';
  div.textContent = text;
  container.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

// ── send message ───────────────────────────────────────────
const input = document.getElementById('message-input');
let typingTimer;

input.addEventListener('input', () => {
  if (!activeRoomId) return;
  socket.emit('typing:start', { roomId: activeRoomId });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('typing:stop', { roomId: activeRoomId });
  }, 1500);
});

document.getElementById('message-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !activeRoomId) return;
  socket.emit('message:send', { roomId: activeRoomId, text });
  input.value = '';
  socket.emit('typing:stop', { roomId: activeRoomId });
  clearTimeout(typingTimer);
});

// ── logout ─────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  if (socket) socket.disconnect();
  sessionStorage.clear();
  document.getElementById('chat-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  activeRoomId = null;
});
