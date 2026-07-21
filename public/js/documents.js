// Per-room document management: upload, list, refresh.
// Reads active room id from sessionStorage (same source as chat.js).

window.documents = {
  async loadDocuments(roomId) {
    const list = document.getElementById('document-list');
    if (!list) return;
    list.innerHTML = '<li class="doc-empty">Loading...</li>';
    try {
      const res = await fetch(`/api/rooms/${roomId}/documents`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const docs = await res.json();
      renderDocuments(docs);
    } catch (err) {
      console.error('[documents] load failed:', err);
      list.innerHTML = '<li class="doc-empty">Failed to load</li>';
    }
  },

  async uploadDocument(roomId, file) {
    const status = document.getElementById('doc-upload-status');
    status.textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/rooms/${roomId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Upload failed');
      status.textContent = `Uploaded (${result.chunks} chunks)`;
      await window.documents.loadDocuments(roomId);
      setTimeout(() => { status.textContent = ''; }, 3000);
    } catch (err) {
      console.error('[documents] upload failed:', err);
      status.textContent = `Error: ${err.message}`;
    }
  },

  async deleteDocument(roomId, documentId) {
    if (!confirm('Delete this document from the room?')) return;
    try {
      const res = await fetch(`/api/rooms/${roomId}/documents/${documentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await window.documents.loadDocuments(roomId);
    } catch (err) {
      console.error('[documents] delete failed:', err);
      alert('Failed to delete document.');
    }
  },

  clear() {
    const list = document.getElementById('document-list');
    if (list) list.innerHTML = '';
    const status = document.getElementById('doc-upload-status');
    if (status) status.textContent = '';
  },
};

function renderDocuments(docs) {
  const list = document.getElementById('document-list');
  list.innerHTML = '';
  if (docs.length === 0) {
    list.innerHTML = '<li class="doc-empty">No documents yet</li>';
    return;
  }
  for (const doc of docs) {
    const li = document.createElement('li');
    li.className = 'doc-item';
    li.title = `${doc.chunks} chunks, uploaded ${new Date(doc.createdAt).toLocaleString()}`;

    const label = document.createElement('span');
    label.className = 'doc-item-label';
    label.textContent = `📄 ${doc.title}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'doc-delete-btn';
    btn.title = 'Delete document';
    btn.textContent = '🗑';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roomId = sessionStorage.getItem('activeRoomId');
      if (roomId) window.documents.deleteDocument(roomId, doc.documentId);
    });

    li.appendChild(label);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

// Wire the hidden file input's change event once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('doc-upload-input');
  if (!input) return;
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const roomId = sessionStorage.getItem('activeRoomId');
    if (!roomId) {
      alert('Please select a room before uploading a document.');
      e.target.value = '';
      return;
    }
    window.documents.uploadDocument(roomId, file);
    // Reset so re-selecting the same file still fires the change event.
    e.target.value = '';
  });
});
