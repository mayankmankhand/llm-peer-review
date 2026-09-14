'use strict';

// env-local.js - the one .env.local lookup behind ask-gpt.js, ask-gemini.js, and
// gen-media.js (issue #177). Each script requires it from its own folder, which holds
// in both the copy-install layout and the plugin layout:
//
//   const { loadEnvLocal } = require('./env-local.js');
//   loadEnvLocal(); // fills process.env before anything reads it
//
// Why it exists: each script used to carry its own copy of an upward walk that
// started at the script's OWN folder (__dirname) and gave up after 6 levels. That
// reached the project's .env.local while the scripts were copied into every project.
// A plugin runs them from ~/.claude/plugins/cache/llm-peer-review/tk/<version>/scripts/,
// where the same walk only ever reached ~/.claude/plugins/.env.local, so a project's
// own file was never read.
//
// The order, per variable, first value wins:
//   1. A real environment variable. Never overwritten.
//   2. The project's .env.local. Searched from the working directory (the project the
//      command runs in) upward, stopping at the first directory that contains .git
//      (that directory is still searched) or at the filesystem root. Only the nearest
//      file is read.
//   3. The machine file, ~/.claude/plugins/.env.local, found by that exact path: one
//      file for every project on this machine.
// So when both files set a variable, the project file wins, and the machine file only
// fills what the project leaves out. An empty value counts as not set at every step,
// as it always has: a project .env.local copied from .env.local.example with its keys
// still blank does not hide the machine file's keys. Model and tuning variables
// (GPT_MODEL, GEMINI_MAX_TOKENS, FAL_VIDEO_MODEL, ...) follow the same order, because
// they come from the same files.
//
// Parsing is unchanged from the three copies this replaces (scripts/test-env-local.js
// keeps a frozen copy of that code and compares): one KEY=value per line, an optional
// leading `export `, blank lines and `#` comment lines skipped, one pair of matching
// surrounding quotes stripped, CRLF files fine because every line is trimmed, and the
// first non-empty value of a key inside one file wins. No multiline values, no
// variable expansion, no inline comments.
//
// Dependency-free: gen-media.js runs without an npm install, so this module must too.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE_NAME = '.env.local';

// The three places in lookup order, in plain English, for error messages.
const PLACES = [
  'the environment',
  "the project's .env.local (from the working directory up to the git root)",
  '~/.claude/plugins/.env.local',
];

// Parse the text of one .env.local into [key, value] pairs, in file order.
function parseEnvLocal(text) {
  const pairs = [];
  text.split('\n').forEach((line) => {
    // Skip empty lines and comments. trim() also drops a CRLF file's trailing \r.
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) return;
    const match = trimmedLine.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    // Strip surrounding quotes (single or double) that some tutorials show
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    pairs.push([key, value]);
  });
  return pairs;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

// process.cwd() throws when the working directory was deleted, and os.homedir() can
// throw with no HOME and no user record. Neither is worth a crash: that place is
// simply not searched, and the script's missing-key message says where to look.
function tryOrNull(fn) {
  try {
    return fn() || null;
  } catch (e) {
    return null;
  }
}

// The project's .env.local: the nearest one at or above startDir, never looking above
// the first directory that holds .git. Returns an absolute path, or null.
function findProjectEnvLocal(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, FILE_NAME);
    if (isFile(candidate)) return candidate;
    // .git is a folder in a clone and a file in a worktree or submodule. Either way
    // this directory is the project root, so the search ends with it.
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // the filesystem root
    dir = parent;
  }
}

function machineEnvLocalPath(homedir) {
  return path.join(homedir, '.claude', 'plugins', FILE_NAME);
}

// Fill env from the project file, then the machine file, never replacing a value that
// is already set and non-empty. A missing file is not an error. Options, all optional
// and there for tests: cwd (default process.cwd()), homedir (default os.homedir()),
// env (default process.env).
//
// Returns { project, machine, read }: the path of each file that was read, or null
// when there was none (machine is also null when it is the very file the project
// search found), and read, those paths in the order they were applied.
function loadEnvLocal(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const cwd = opts.cwd || tryOrNull(() => process.cwd());
  const homedir = opts.homedir || tryOrNull(() => os.homedir());
  const project = cwd ? findProjectEnvLocal(cwd) : null;
  const machinePath = homedir ? machineEnvLocalPath(homedir) : null;
  const machine = machinePath && machinePath !== project && isFile(machinePath) ? machinePath : null;
  // This order IS the precedence: a value the project file sets is already in env when
  // the machine file is read, so the machine file cannot replace it.
  const read = [project, machine].filter(Boolean);
  for (const file of read) {
    for (const [key, value] of parseEnvLocal(fs.readFileSync(file, 'utf-8'))) {
      // Only set if not already in the environment (an empty value counts as unset)
      if (!env[key]) env[key] = value;
    }
  }
  return { project, machine, read };
}

// The three places, in lookup order.
function lookupPlaces() {
  return PLACES.slice();
}

// The three places as one phrase for a message:
//   `OPENAI_API_KEY not found in ${describeLookup()}.`
function describeLookup() {
  return `${PLACES[0]}, ${PLACES[1]}, or ${PLACES[2]}`;
}

module.exports = {
  loadEnvLocal,
  parseEnvLocal,
  findProjectEnvLocal,
  machineEnvLocalPath,
  lookupPlaces,
  describeLookup,
};
