'use strict';
// Notebook: a small notes server with no dependencies.
// Notes live in data/notes.json; the page and its assets live in public/.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'notes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_NOTE_LENGTH = 500;

const ASSETS = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

function loadNotes() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveNotes(notes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2) + '\n');
}

let notes = loadNotes();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function newestFirst(list) {
  return list.slice().sort((a, b) => b.created.localeCompare(a.created));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/notes') {
    return sendJson(res, 200, newestFirst(notes));
  }
  if (req.method === 'POST' && url.pathname === '/api/notes') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: 'Send a JSON body like {"text": "..."}' });
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text === '' || text.length > MAX_NOTE_LENGTH) {
      return sendJson(res, 400, { error: 'A note needs 1 to ' + MAX_NOTE_LENGTH + ' characters.' });
    }
    const note = { id: Date.now().toString(36), created: new Date().toISOString(), text };
    notes.push(note);
    saveNotes(notes);
    return sendJson(res, 201, note);
  }
  return sendJson(res, 404, { error: 'Not found' });
}

function serveAsset(req, res, url) {
  const asset = ASSETS[url.pathname];
  if (!asset) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  fs.readFile(path.join(PUBLIC_DIR, asset.file), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Could not read ' + asset.file);
    }
    res.writeHead(200, { 'Content-Type': asset.type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => sendJson(res, 500, { error: err.message }));
    return;
  }
  serveAsset(req, res, url);
});

server.listen(PORT, () => {
  console.log('Notebook running at http://localhost:' + PORT);
});
