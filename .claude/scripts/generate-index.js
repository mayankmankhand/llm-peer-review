#!/usr/bin/env node

// generate-index.js - Builds INDEX.md from git-tracked files
// Uses git ls-files so .gitignore exclusions are respected automatically.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

// Get all tracked files
let raw;
try {
  raw = execSync("git ls-files", { cwd, encoding: "utf8" });
} catch (err) {
  console.error("Error: git ls-files failed. Are you in a git repository?");
  process.exit(1);
}

const files = raw
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

if (files.length === 0) {
  // Create a minimal INDEX.md so /explore knows the index exists but the repo is empty
  const emptyContent = [
    `<!-- Generated: (empty repo) -->`,
    `# Project Index`,
    "",
    "No tracked files yet. Commit some files and run /index to regenerate.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(cwd, "INDEX.md"), emptyContent, "utf8");
  console.log("INDEX.md generated (0 files - empty repo)");
  process.exit(0);
}

// Build a nested tree: each node is { dirs: {}, files: [] }
function createNode() {
  return { dirs: {}, files: [] };
}

const root = createNode();

for (const filePath of files) {
  const parts = filePath.split("/");
  let node = root;

  // Walk/create directory nodes for all but the last segment
  for (let i = 0; i < parts.length - 1; i++) {
    const dir = parts[i];
    if (!node.dirs[dir]) {
      node.dirs[dir] = createNode();
    }
    node = node.dirs[dir];
  }

  // Last segment is the filename
  node.files.push(parts[parts.length - 1]);
}

// Render the tree as indented markdown lines
const lines = [];

function render(node, indent) {
  const prefix = " ".repeat(indent);

  // Directories first, sorted
  const dirNames = Object.keys(node.dirs).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  for (const dir of dirNames) {
    lines.push(`${prefix}- ${dir}/`);
    render(node.dirs[dir], indent + 2);
  }

  // Then files, sorted
  const sortedFiles = node.files.slice().sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
  for (const file of sortedFiles) {
    lines.push(`${prefix}- ${file}`);
  }
}

render(root, 0);

// Build the timestamp
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
// Use UTC so the timestamp is unambiguous regardless of local timezone
const timestamp = [
  now.getUTCFullYear(),
  "-",
  pad(now.getUTCMonth() + 1),
  "-",
  pad(now.getUTCDate()),
  " ",
  pad(now.getUTCHours()),
  ":",
  pad(now.getUTCMinutes()),
  " UTC",
].join("");

// Assemble the document
const content = [
  `<!-- Generated: ${timestamp} -->`,
  `# Project Index`,
  "",
  ...lines,
  "", // trailing newline
].join("\n");

// Write to INDEX.md in the working directory
const outPath = path.join(cwd, "INDEX.md");
fs.writeFileSync(outPath, content, "utf8");

console.log(`INDEX.md generated (${files.length} files)`);
