'use strict';

const list = document.getElementById('notes');
const form = document.getElementById('note-form');
const textInput = document.getElementById('note-text');
const status = document.getElementById('status');
const searchInput = document.getElementById('search-box');
const clearButton = document.getElementById('clear-all');

function render(notes) {
  list.innerHTML = '';
  if (notes.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No notes yet. Write your first one above.';
    list.appendChild(empty);
    return;
  }
  for (const note of notes) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = note.created;
    time.textContent = new Date(note.created).toLocaleString();
    const text = document.createElement('p');
    text.textContent = note.text;
    item.append(time, text);
    list.appendChild(item);
  }
}

async function loadNotes(query) {
  const url = query ? '/api/notes?q=' + encodeURIComponent(query) : '/api/notes';
  const res = await fetch(url);
  render(await res.json());
}

searchInput.addEventListener('input', () => {
  loadNotes(searchInput.value.trim());
});

clearButton.addEventListener('click', async () => {
  await fetch('/api/notes', { method: 'DELETE' });
  status.textContent = 'All notes removed.';
  loadNotes();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: textInput.value }),
  });
  const body = await res.json();
  if (!res.ok) {
    status.textContent = body.error;
    return;
  }
  status.textContent = 'Saved.';
  textInput.value = '';
  loadNotes();
});

loadNotes();
