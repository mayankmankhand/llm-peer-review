#!/usr/bin/env node
'use strict';
// render-diagrams.js - turn the docs' diagram sources into the images the docs
// show. Maintainer-only: it lives in scripts/ and never ships.
//
//   node scripts/render-diagrams.js            render every docs/diagrams/*.mmd
//   node scripts/render-diagrams.js <name>...  render only these (no .mmd suffix)
//   node scripts/render-diagrams.js --preview  also write a page of this run's
//                                              images: artifacts/html/diagrams-preview.html
//
// Why images and not live Mermaid blocks: GitHub's phone app shows a Mermaid
// block as raw code, and a large one shrinks past reading on a phone. An SVG
// in a <picture> reads everywhere, in the viewer's light or dark theme.
//
// Each source is Mermaid text with {{token}} color placeholders, where token is
// a custom property from .claude/skills/shared/shells/tokens.css without its
// leading dashes ({{accent}}, {{warn-soft}}). Each one renders twice, once per
// palette, to docs/images/diagrams/<name>-light.svg and <name>-dark.svg. A
// source may set its own Mermaid config in front matter (layout: elk for the
// line diagrams); the base settings below apply under it.
//
// Line 1 of every image is a render line holding a hash of everything the
// render read: the source, the theme's palette, the Mermaid version and the
// base settings. scripts/test-docs.js recomputes that hash without rendering,
// so a source edited after its render fails the test, and CI needs no browser.
//
// The engine: playwright-core from .claude/scripts/node_modules (the toolkit's
// own dependency) drives Chromium, and Mermaid is fetched once with `npm pack`
// at a pinned version into the gitignored scripts/.cache/. npm checks the
// package against the registry's integrity hash. ELK ships inside the 12.x
// bundle. A fixed id per image and handDrawnSeed make the output repeatable:
// two renders of the same source are byte-identical.
//
// Dependency-free beyond those two; git-free.
// Exit codes: 0 rendered, 1 a render or setup failure, 2 usage error.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SOURCE_DIR = 'docs/diagrams';
const IMAGE_DIR = 'docs/images/diagrams';
const TOKENS_PATH = '.claude/skills/shared/shells/tokens.css';
const PREVIEW_PATH = 'artifacts/html/diagrams-preview.html';
const MERMAID_VERSION = '12.2.0';
const CACHE_DIR = path.join(__dirname, '.cache', 'mermaid-' + MERMAID_VERSION);
const THEMES = ['light', 'dark'];
const SIZE_CAP = 100 * 1024;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// The base Mermaid settings, minus colors. Part of the hash: change one and
// every image goes stale until it is rendered again.
const BASE = {
  startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic',
  handDrawnSeed: 1, layout: 'dagre', htmlLabels: false, markdownAutoWrap: false,
  flowchart: { htmlLabels: false, curve: 'basis', padding: 14, wrappingWidth: 360, nodeSpacing: 30, rankSpacing: 34 },
  sequence: { mirrorActors: false, actorMargin: 60, noteMargin: 12, messageMargin: 36 },
};

// tokens.css -> { light: {token: value}, dark: {token: value} }. Light is the
// bare :root block; dark is the light set with the [data-theme="dark"] block
// laid over it, because the dark blocks redefine only what changes.
function readPalettes(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\r\n/g, '\n');
  const block = re => { const m = text.match(re); return m ? m[1] : ''; };
  const parse = body => {
    const out = {};
    for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  const light = parse(block(/(?:^|\n)\s*:root\s*\{([^}]*--bg\s*:[^}]*)\}/));
  const dark = Object.assign({}, light, parse(block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)));
  if (!light.bg || dark.bg === light.bg) throw new Error('could not read the light and dark palettes from ' + TOKENS_PATH);
  return { light, dark };
}

// The Mermaid config for one palette: the base settings plus theme variables
// mapped from the toolkit's tokens.
function renderConfig(palette, theme) {
  const p = palette;
  return Object.assign(JSON.parse(JSON.stringify(BASE)), {
    themeVariables: {
      darkMode: theme === 'dark', background: p.bg, fontFamily: FONT, fontSize: '16px',
      primaryColor: p['bg-muted'], primaryBorderColor: p.border, primaryTextColor: p.text,
      secondaryColor: p['accent-soft'], tertiaryColor: p.bg, lineColor: p['text-muted'], textColor: p.text,
      mainBkg: p['bg-muted'], nodeBorder: p.border, clusterBkg: p.bg, clusterBorder: p.border,
      edgeLabelBackground: p.bg, titleColor: p.text,
      actorBkg: p['bg-muted'], actorBorder: p.border, actorTextColor: p.text, actorLineColor: p.border,
      signalColor: p.text, signalTextColor: p.text, labelBoxBkgColor: p['bg-muted'],
      labelBoxBorderColor: p.border, labelTextColor: p.text, loopTextColor: p.text,
      noteBkgColor: p['warn-soft'], noteTextColor: p.text, noteBorderColor: p.warn,
      activationBkgColor: p['accent-soft'], activationBorderColor: p.accent,
    },
  });
}

// Fill {{token}} placeholders from one palette. An unknown token is an error,
// never a silent blank.
function fill(source, palette, name) {
  return source.replace(/\{\{([a-z0-9-]+)\}\}/g, (all, token) => {
    if (!(token in palette)) throw new Error(name + '.mmd: unknown color token {{' + token + '}}');
    return palette[token];
  });
}

// The hash on an image's render line. Line endings are normalized first, so a
// Windows checkout that turns LF into CRLF does not make every image stale.
function sourceHash(source, theme, palette) {
  const input = JSON.stringify({ mermaid: MERMAID_VERSION, base: BASE, theme, palette, source: source.replace(/\r\n/g, '\n') });
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hashLine(name, theme, sha256) {
  return '<!-- render: sha256=' + sha256 + ' mermaid=' + MERMAID_VERSION + ' theme=' + theme +
    ' source=' + SOURCE_DIR + '/' + name + '.mmd; regenerate with node scripts/render-diagrams.js -->';
}

function parseHashLine(svg) {
  const m = svg.match(/^<!-- render: sha256=([0-9a-f]{64}) mermaid=(\S+) theme=(\S+) source=(\S+?);/);
  return m ? { sha256: m[1], mermaid: m[2], theme: m[3], source: m[4] } : null;
}

// Paint the page color behind the drawing. Mermaid leaves the canvas clear, so
// a light image shown on a dark page (some viewers always pick the light one)
// would put dark text on a dark ground.
function withBackground(svg, color) {
  const vb = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!vb) return svg;
  const rect = '<rect x="' + vb[1] + '" y="' + vb[2] + '" width="' + vb[3] + '" height="' + vb[4] + '" fill="' + color + '"/>';
  return svg.replace(/(<svg\b[^>]*>)/, '$1' + rect);
}

function ensureMermaid() {
  const file = path.join(CACHE_DIR, 'package', 'dist', 'mermaid.min.js');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log('Fetching mermaid@' + MERMAID_VERSION + ' into ' + path.relative(REPO, CACHE_DIR) + ' (once)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pack = spawnSync(npm, ['pack', 'mermaid@' + MERMAID_VERSION, '--pack-destination', CACHE_DIR, '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
  const tgz = path.join(CACHE_DIR, 'mermaid-' + MERMAID_VERSION + '.tgz');
  if (pack.status !== 0 || !fs.existsSync(tgz)) throw new Error('npm pack mermaid@' + MERMAID_VERSION + ' failed: ' + (pack.stderr || pack.error || '').toString().trim());
  const tar = spawnSync('tar', ['-xzf', tgz, '-C', CACHE_DIR], { encoding: 'utf8' });
  if (tar.status !== 0 || !fs.existsSync(file)) throw new Error('could not unpack ' + tgz + ': ' + (tar.stderr || tar.error || '').toString().trim());
  return file;
}

function loadPlaywright() {
  const dir = path.join(REPO, '.claude', 'scripts', 'node_modules', 'playwright-core');
  try { return require(dir); } catch (e) {
    throw new Error('playwright-core is not installed. Run: npm ci --prefix .claude/scripts');
  }
}

async function render(names, opts) {
  const palettes = readPalettes(fs.readFileSync(path.join(REPO, TOKENS_PATH), 'utf8'));
  const mermaidJs = ensureMermaid();
  const { chromium } = loadPlaywright();
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    throw new Error('Chromium could not start. Install it with:\n  npx --prefix .claude/scripts playwright-core install chromium\n' +
      'On WSL/Linux, also run:\n  sudo npx playwright-core install-deps chromium\n(' + String(e.message || e).split('\n')[0] + ')');
  }
  const written = [];
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: mermaidJs });
    fs.mkdirSync(path.join(REPO, IMAGE_DIR), { recursive: true });
    for (const name of names) {
      const source = fs.readFileSync(path.join(REPO, SOURCE_DIR, name + '.mmd'), 'utf8');
      for (const theme of THEMES) {
        const palette = palettes[theme];
        const src = fill(source.replace(/\r\n/g, '\n'), palette, name);
        const config = renderConfig(palette, theme);
        let svg;
        try {
          svg = await page.evaluate(async ({ src, config, id }) => {
            mermaid.initialize(config);
            return (await mermaid.render(id, src)).svg;
          }, { src, config, id: name + '-' + theme });
        } catch (e) {
          throw new Error(name + '.mmd (' + theme + '): ' + String(e.message || e).split('\n').slice(0, 3).join(' '));
        }
        const out = hashLine(name, theme, sourceHash(source, theme, palette)) + '\n' + withBackground(svg, palette.bg) + '\n';
        const rel = IMAGE_DIR + '/' + name + '-' + theme + '.svg';
        fs.writeFileSync(path.join(REPO, rel), out);
        const size = Buffer.byteLength(out);
        written.push({ name, theme, rel, size, svg: out });
        console.log('  ' + rel + ' (' + Math.round(size / 1024) + ' KB)' + (size > SIZE_CAP ? '  OVER THE ' + SIZE_CAP / 1024 + ' KB CAP' : ''));
      }
    }
  } finally {
    await browser.close();
  }
  if (opts.preview) writePreview(palettes, names);
  return written;
}

// A self-contained page showing this run's images, light then dark, each on
// its theme's page color and at the width GitHub gives an image: the surface
// the design critic judges. Nothing else is on it, so a judge weighs only the
// diagrams (phone width is checked separately).
function writePreview(palettes, names) {
  const img = (name, theme) => {
    const file = path.join(REPO, IMAGE_DIR, name + '-' + theme + '.svg');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^<!--[^\n]*-->\n/, '') : '<p>missing</p>';
  };
  const sections = names.flatMap(name => THEMES.map(theme =>
    '<section style="background:' + palettes[theme].bg + '"><div class="w">' + img(name, theme) + '</div></section>')).join('');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Diagram Preview</title><style>' +
    'body{margin:0}section{padding:32px 24px}.w{max-width:880px;margin:0 auto}svg{max-width:100%;height:auto;display:block;margin:0 auto}' +
    '</style></head><body>' + sections + '</body></html>';
  fs.mkdirSync(path.dirname(path.join(REPO, PREVIEW_PATH)), { recursive: true });
  fs.writeFileSync(path.join(REPO, PREVIEW_PATH), html);
  console.log('  ' + PREVIEW_PATH);
}

function listSources() {
  const dir = path.join(REPO, SOURCE_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.mmd')).map(n => n.slice(0, -4)).sort() : [];
}

module.exports = { SOURCE_DIR, IMAGE_DIR, TOKENS_PATH, MERMAID_VERSION, THEMES, SIZE_CAP, readPalettes, renderConfig, sourceHash, parseHashLine };

if (require.main === module) {
  const args = process.argv.slice(2);
  const preview = args.includes('--preview');
  const unknown = args.filter(a => a.startsWith('-') && a !== '--preview');
  if (unknown.length) { console.error('usage: node scripts/render-diagrams.js [<name>...] [--preview]'); process.exit(2); }
  const all = listSources();
  const names = args.filter(a => !a.startsWith('-'));
  const missing = names.filter(n => !all.includes(n));
  if (missing.length) { console.error('no such diagram source: ' + missing.map(n => SOURCE_DIR + '/' + n + '.mmd').join(', ')); process.exit(2); }
  render(names.length ? names : all, { preview }).then(w => {
    console.log('Rendered ' + w.length + ' images.');
    process.exit(w.some(x => x.size > SIZE_CAP) ? 1 : 0);
  }, e => { console.error('render-diagrams: ' + e.message); process.exit(1); });
}
