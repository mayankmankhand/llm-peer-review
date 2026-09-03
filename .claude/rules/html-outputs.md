# HTML Output Rules

<!-- Toolkit version: 6.3.1 | Managed by LLM Peer Review. Do not edit - changes will be overwritten on update. -->

## Purpose

Documents when toolkit commands produce HTML output, why, and how that HTML must behave. Exists so HTML treatment stays consistent across `/create-plan`, `/review-*`, `/document`, `/explore`, `/ask-*`, `/codebase-to-course`, and the `/playground` skill, without each command's prompt restating the rules.

## Reader/Claude Principle (core rule)

Three categories govern format:

| What | Format | Why |
|---|---|---|
| Outputs Claude reads later (`CODEBASE_MAP.md`, `PLAN-*.md`, shared templates, command/skill prompts, rules) | Markdown, always | Claude parses markdown reliably; HTML is wasted tokens for re-ingestion |
| Outputs the user reads (review reports, plan progress, debate summaries, cycle summaries, explainers) | Markdown by default. HTML when (a) the command is on the default-on list, OR (b) Claude judges HTML adds value | Most outputs stay markdown for speed; HTML is reserved for moments where scan-ability or comparison genuinely changes the experience |
| Outputs the user *does something with* (compare options, drag/order, tune values, click through) | HTML playground (interactive) | Static markdown cannot support the loop |

When Claude generates HTML in the judgement category, it announces upfront:

> "Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."

## Default-on Commands

HTML is always generated for these. No judgement call.

| Command | Reason |
|---|---|
| `/codebase-to-course` | Already HTML today |
| `/create-plan` | Plans are always long. Dual-track (markdown canonical + HTML view) is always worth it |
| `/document` (cycle summary) | One-page "what shipped this cycle" runs every time `/document` does |
| `/explore` design step, load level new | The three-prototype playground always fires (`.claude/skills/shared/design-rules.md`): picking between rendered designs is a user-doing-something loop, not a judgement call |

Markdown remains canonical even when HTML is also generated. Claude reads the markdown; HTML is the rendered view for the user.

## Claude's Judgement (everything else)

For all other commands, Claude decides per-output whether HTML adds value. Default is markdown; generate HTML when:

- `/review` family: whenever the run has any surviving finding, or the standing page `artifacts/html/review.html` already exists (so a clean run can take it to empty). Findings count, visual evidence, and severity mix no longer gate it (review of the #162 cycle, R2)
- `/explore` vision-mode summary: 2+ options being compared
- `/ask-gpt` / `/ask-gemini`: 3+ Recommended Actions in the final summary
- `/audit-html`: 5+ candidates listed in the report
- `/learning-opportunity` (planned - not yet wired): 3+ depth levels with concrete examples at each, OR the concept is interactive (state machines, hashing, retries, etc.)
- `/pair-debug` (planned - not yet wired): 3+ hypotheses tracked

**When in doubt, skip HTML.** Markdown is the default; HTML is additive. Generating HTML for borderline cases creates inconsistent UX from session to session.

## Playground Export-Loop Rule

The `/playground` skill produces throwaway interactive HTML at `/tmp/playground-{timestamp}.html`. Hard rules:

1. **HTML never reads back into the toolkit.** Output is text the user pastes manually into chat. No file modifications to any prompt file, skill file, or rules file.
2. Every playground HTML ends with a **"copy as markdown"** or **"copy as prompt"** button that emits text the user can paste back as a new chat message.
3. Self-contained: one HTML file, inline CSS/JS, no CDN. Works offline.
4. Disposable: lands in `/tmp/`, never in the repo.

The `/explore` design step dispatches the playground's rendered-prototypes variant with click-to-expand as a fixed primitive; the pick and notes come back through the same copy button as every other playground.

## Artifact Locations

| Where HTML lands | When |
|---|---|
| `/tmp/playground-*.html` | Playground throwaways (interactive, disposable) |
| `plans/PLAN-*.html` | Plan renders, alongside `PLAN-*.md`. Gitignored. |
| `artifacts/html/` | Cycle-bound artifacts (document summaries, debate views, explore option comparisons, audit reports) - timestamped. Also the two `--stable` views, not timestamped: the standing review page `review.html` and `/audit-html` static views. Gitignored. |
| `artifacts/html/index.jsonl` | One appended JSON line per published artifact (type, name, local path, URL, timestamp). Written and read by `render-html.js`, never edited by hand. It is the record; each published local file also carries its URL on line 1 as `<!-- hosted: <url> -->`, a derived copy that `--index-sync` regenerates from the newest record per file. Gitignored with the rest of `artifacts/html/`. |

The `artifacts/html/` directory lives at the project root. It parallels `plans/` and `reports/` (both gitignored user-facing working dirs).

### Generation mechanism (render-html.js)

The seven helper-rendered output types (review, document, explore, debate, audit, plan, docview) are NOT hand-written. Each command produces a compact JSON payload and runs the shared helper, which injects that JSON plus the shared `tokens.css` into a prebuilt shell and writes the file:

```
node .claude/scripts/render-html.js --shell <review|debate|document|explore|audit|plan|docview> --name <basename> --data <json-file> [--out-dir <dir>] [--stable] [--no-abs]
```

By default the helper computes a unique timestamped name `<basename>-YYYY-MM-DD-HHMMSS.html` (with a `-N` guard for same-second runs), creates `artifacts/html/`, overwrites freely, and prints the output path to stdout. This is what keeps the open fast and collision-free (issues #120, #127): the command emits only the small JSON, never the boilerplate, and there is never a read-then-overwrite cycle. The prebuilt shells live in `.claude/skills/shared/shells/`; each documents its own JSON schema in a header comment.

The three identity-keyed types use `--stable`, which writes exactly `<basename>.html` (no timestamp, no `-N` guard) and replaces the file on re-run - the right behavior for a view whose identity outlives any one run (issue #129): plan HTML (`--shell plan --out-dir plans --stable` -> `plans/PLAN-<basename>.html`, replaced on re-plan), the standing review page (`--shell review --stable` -> `artifacts/html/review.html`, replaced on every review run; issue #161), and the `/audit-html` opt-in static view (`--shell docview --stable` -> `artifacts/html/<source-basename>.html`, replaced when regenerated).

**Exception** (still hand-rendered, NOT via the helper): `/playground` throwaways (`/tmp/`, interactive).

## Viewing the Artifact

HTML artifacts are meant to be *viewed rendered in a browser*, not read as source. Do not hand the user a file link and stop: in an editor like Cursor or VS Code, clicking a file link opens the HTML source, which is exactly the friction this rule removes.

There are two viewports. **The hosted page is the primary one; the local browser open is the fallback.** This is the one decision, and every command points here rather than restating it:

```
render-html.js has printed a path
  -> Can this session publish? (the countable gate below)
    -> NO:  open it locally with open-artifact.sh. Done - this is the whole flow.
    -> YES: the render should have used --no-abs (see "Render for the viewport")
      -> publish to the private claude.ai page, record it (which stamps the local file), hand over the URL.
```

A user is never left with only a file path. Whichever branch runs, exactly one viewport opens, and neither branch asks the user for permission first; "Publishing the Artifact" below says why, and lists what is still gated.

### Render for the viewport

**Decide this BEFORE you run the render, not after.** The flag cannot be added to a file that is already written, and every call site below prints a copy-ready command; check the publish gate first, then run the command with or without the flag accordingly.

**When the session can publish, pass `--no-abs` to `render-html.js`.** Five of the seven shells turn a file reference into a `vscode://file/<absPath>` editor link, so without the flag a published page carries this machine's directory layout and account name. The flag deletes those absolute paths, and each of the five shells then renders that file reference as plain text rather than as a link - an editor link built from a relative path would leak nothing but be dead for every viewer. Those editor links only ever resolved on the machine that made them anyway, so they were dead for any other viewer. It also rewrites the repo root and home directory out of the page text wherever they appear as prose, so file references read as repo-relative; it does not claim to remove every absolute path on the filesystem.

The flag is keyed to the **capability gate** alone. A session that can publish renders without absolute paths, full stop: there is no later answer that could change where the page goes, so there is nothing to wait for and no second render to avoid.

A session that cannot publish renders normally and keeps its editor links, which is where they are actually useful.

### Opening it locally (the fallback)

Handing the file to the browser is not an outward-facing send: the file stays on this machine, and the browser is simply a different application opening it. This branch never asks the user for permission. If Claude Code itself asks permission to run `open-artifact.sh`, that is a `settings.local.json` allow-list matter (setup seeds the entry), not something this rule can grant or withhold.

Use the toolkit's opener script, which tries each platform launcher in order with real fallback and only fails when the environment is genuinely headless:

```bash
bash .claude/scripts/open-artifact.sh "<file>"
```

Pass the absolute path `render-html.js` printed (the script resolves either an absolute or a project-relative path). It handles macOS (`open`), WSL (PowerShell `Start-Process`, located on PATH or by full path, then `explorer.exe`), and Linux (`xdg-open`). It exits `0` when a launcher succeeded, `1` when every launcher failed or the path did not resolve; on WSL the headless message also prints the Windows-side (UNC) path so it can be pasted into a Windows browser.

- **On exit 0:** tell the user it opened, with the path, e.g. "Opened the review in your browser: `artifacts/html/review.html`".
- **On exit 1:** do not retry in a loop. The script already prints the "open this in your browser (not the editor)" guidance with the path, so relay that rather than restating it. If the path may be wrong, re-check it resolves from the project root before assuming the environment is headless.

The `/playground` skill sits outside all of this: it never publishes and never auto-opens, because its output is throwaway `/tmp/` HTML the user pastes back (see the Playground Export-Loop Rule). It emits a clickable `file://` link in chat instead.

## Publishing the Artifact (the primary viewport)

**The gate is countable.** Publish only when a tool for publishing a file to a hosted artifact page is present in this session's tool list. When it is not (Cursor, or the feature is off for that user), skip this section silently and open locally instead. Do not mention it, do not apologise, do not suggest switching editors. The local open is a complete outcome, not a degraded one.

**No consent ask.** Publishing sends the rendered file to a page under `claude.ai` that is private by default, and the toolkit never touches a page's sharing setting. That is not an outward-facing send under M9 in `.claude/skills/shared/hitl-loop.md`: the page reaches no one the user has not chosen themselves. So a publish-capable session publishes every artifact type - plan, document, explore, docview, audit, review, and debate alike - without asking first, exactly as the local fallback opens a file without asking. M9 names this exemption; it is one of the two outward sends M9 exempts, the other being the chained `/document` PR.

**Say what a review or debate page holds.** A review or debate page can quote code excerpts and security findings the user has not read yet, and under this rule they reach the private page before the user sees them. The previous rule asked for consent at publish time on every review and debate run; on 2026-08-31 the owner judged that ask unnecessary because the page is private to their own account. The cost is that findings can land on the page before they are read, which is why, when you hand over such a link, you say in one clause what the page contains. The link is never a surprise.

**What remains gated.** Everything else in M9 stands:

- Every other M9 always-ask action: edits to prompt files, releases and version bumps, deletions of user data, force pushes.
- Any send the loop would make on its own to a destination that is not a private `claude.ai` page: an issue or PR comment, email, a shared drive. Those still ask; M9's other named exemption, the chained `/document` PR, is unchanged. (`/ask-gpt`, `/ask-gemini`, and `/peer-review` are a different gate: they run only when a human types them and are never chained into, per M14.)
- Sharing. The toolkit never changes a page from private to shared and never hands a link to anyone but the user. A request to share a page is an outward send and asks. An update to a `--stable` page the user has since shared reaches whoever they shared it with; that is the user's sharing choice, not a toolkit send.
- `/error-analysis` output. It is never published and never sent anywhere, with no consent path at all; that rule is stronger than this one and is untouched.
- The M11 pre-push tripwire. Publishing an artifact is not a push; every push is still scanned.
- The `--no-abs` render for publish-capable sessions, which still runs on every render bound for a page.

**Naming is already handled.** `render-html.js` writes the payload's title into the page's `<title>`, and that tag is what names the published page. A title passed alongside the file is ignored when the file carries its own tag.

**Use a fixed icon per artifact type.** Publishing takes a tab icon, and the icon is how a user finds the page again among open tabs. Use the same one every time for a given type, so an updated plan does not read as a different page:

| Type | Icon |
|---|---|
| review | 🔍 |
| document | 📋 |
| explore | 🧭 |
| debate | 💬 |
| audit | 📊 |
| plan | 🗺️ |
| docview | 📄 |

Only change a type's icon if that type's purpose changes, never as part of an ordinary update.

**Two publish modes, matching how the file is named.**

| Types | File naming | Publish behavior |
|---|---|---|
| document, explore, debate, audit | timestamped, one file per run | publish a new page each run |
| review, plan, docview | `--stable`, one file per identity | update the one page for that identity |

**Review moved to the identity-keyed row in issue #161.** A new page every run is a backlog, and no per-page redesign touches a backlog: cut every page to 600 words and after forty cycles there are forty unread pages, because reading one changes nothing about the next. One standing page per repo replaces itself, carries only what is open, and can go empty. `render-html.js` reads the page it is about to overwrite and states what changed since the reader last opened it, so a finding they already saw does not present itself as news. The identity is the repo, so the name is the bare `review`. A direct single-lens run names its lens in the payload's `lenses` key, and the helper then replaces only that lens's findings and carries the other lenses' open findings forward, marked, rather than reporting them resolved. The page is rendered once per run, after the auto-fix loop has settled, so what it shows as open is what the loop left open.

For a stable type, look up its recorded page first:

```bash
node .claude/scripts/render-html.js --index-url --name <name>
```

It prints a URL when one has been recorded, nothing when it has not. When a URL comes back, update that page instead of publishing a new one: a plan link that changes on every re-plan is worse than no link. When nothing comes back, publish a new page. The index is keyed to the repository rather than the working directory, so this lookup finds the same record from a worktree as from the main copy.

**Record every publish.** Immediately after a successful publish:

```bash
node .claude/scripts/render-html.js --index-add --type <shell> --name <name> \
     --local <path> --url <url>
```

`<name>` must be the exact `--name` value used for the render, because that is the key `--index-url` looks up. `<path>` must be the path `render-html.js` printed for that render. It has to lie inside the working copy the render ran in (a worktree's own `artifacts/html/` qualifies), and the helper refuses anything outside it. The helper creates `artifacts/html/` if needed, timestamps the record itself, and appends one JSON line. It is never read-then-rewritten, so concurrent sessions cannot clobber each other.

**The record stamps the file.** In the same call, the helper writes the hosted URL onto the first line of that local file as `<!-- hosted: <url> -->`, before the doctype, so the file on disk names the page it mirrors. The index is the record; the stamp is a derived copy of it. A missing local file is a stderr warning, not a failure: the record still lands. To change a URL, append a new record with `--index-add`; it re-stamps the file. A stamp can also go missing on its own: a `--stable` re-render overwrites the file, and a file published before stamping existed never had one. `node .claude/scripts/render-html.js --index-sync` re-derives every stamp from the newest record per local file and prints `index-sync: N stamped, M missing` (plus `, K skipped` when a row was refused: a path outside the repository, a non-HTML file, or a URL that is not a plain `https://` link). Only `.html` mirrors are ever stamped, and only `https://` URLs are accepted. Never edit a stamp by hand, and never stamp a markdown twin: `PLAN-*.md` is read by Claude, and the HTML file is the mirror of the page.

**Failure is not an error.** If a publish does not go through, say so in at most one line, open the file locally instead, and move on. Do not retry in a loop. Nothing is lost.

**What to tell the user.** One line with the link and the local path: "Published the review: <url> (local copy: `artifacts/html/...`)". For a review or debate page, add the one clause about what it holds.

## Visual Look

Typography, color tokens, severity badge colors, and the copy-button pattern live in `.claude/skills/shared/html-look.md`. For the seven helper-rendered artifact types (review, document, explore, debate, audit, plan, docview), those tokens are embodied in `.claude/skills/shared/shells/tokens.css`, which `render-html.js` inlines into every shell at render time - the commands no longer inline `html-look.md` themselves. `tokens.css` mirrors `html-look.md`; update both together when the look changes.

The remaining hand-rendered HTML (`/playground` only) still inlines or reads `html-look.md` directly, since it does not go through a shell.

## Your Own Files (downstream projects)

> **Source of truth:** `/audit-html` inlines this section verbatim as its operational rule set. Edits here change skill behavior. Update both together if you ever split them.

Everything above governs the *toolkit's* command outputs. This section covers the project's own markdown files: notes, dashboards, trackers, runbooks, anything in the repo that a human reads.

The principle is the same and has two layers:

1. **Toolkit command outputs already render HTML for you.** `/create-plan`, `/document`, and the `/review-*` family produce HTML views per the rules above. You do not need to do anything for those.
2. **Your project's own long human-read markdown can get an optional HTML view.** Source stays markdown. The HTML view is additive, rendered from the markdown, and never replaces it.

This is *additive and shape-aware*, never a migration. Every project qualifies for the audit; not every project will have a high-value candidate. A philosophy/decide-once project may legitimately yield "nothing here benefits from an HTML view," and that is a valid result.

### Signals (which of your files might want an HTML view)

- **Read-every-session tracker** - a file you (or your team) open repeatedly to find one thing in many. Status boards, progress logs, decision registers.
- **Markdown degrading into walls of text** - long mixed-format pages where scanning fails: dense tables, nested lists, multi-section docs where the eye loses its place.
- **File so long the human hunts instead of reads** - if your default mental move is Ctrl+F, the page is past the point where flat markdown is helping.
- **Existing hand-built HTML view** - the strongest signal. If someone already wrote a small dashboard or script that turns this markdown into HTML, that proves the value and tells the audit not to suggest building a new one.

### Vetoes (these stay markdown no matter how long)

- **Claude-read files** - `CODEBASE_MAP.md`, `PLAN-*.md`, `CLAUDE.md`, `LESSONS.md`, `LESSONS-detail.md` (the index is parsed every session, the detail on demand), `DESIGN-PROFILE.md` (read before any design work), anything else Claude parses every session. HTML wastes tokens on re-ingestion.
- **Canonical / data-source / self-description** - if the file *is* the source of truth that other tools or scripts parse, markdown is the contract.
- **Host-native** - `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, anything GitHub or GitLab already renders for you.
- **Lives in `.claude/`** - prompt files, skill files, rules. These are Claude's instructions, not human-read pages.

### The skill that applies this section

`/audit-html` scans the project, applies the signals and vetoes above, and reports which files would benefit from an HTML view. It is report-only by default and never converts the source markdown. On request, it can generate a static view of the top candidate into `artifacts/html/`. It also detects projects that already have an HTML-generation setup (a `package.json` dashboard script, a `.js` that reads markdown and serves/emits HTML) and offers to align that output with the toolkit's visual tokens rather than building something new.

## What HTML Does NOT Cover

These stay markdown regardless of length or complexity:

- `CODEBASE_MAP.md` (Claude reads it, not the user)
- `README.md`, `SETUP.md`, `API-KEYS.md`, `AGENT-SETUP.md`, `CONTRIBUTING.md`, `DEMO-SCRIPT.md` (GitHub and GitLab render these natively)
- `CLAUDE.md`, `LESSONS.md` (index, read every session), `LESSONS-detail.md` (read on demand), `DESIGN-PROFILE.md` (read before design work), `.claude/rules/*.md` (read by Claude every session)
- `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` (prompt files)
- `CHANGELOG.md` (per-release notes, host-native)
- `/create-issue` output (issues are markdown on GitHub and GitLab alike)

In one line: **markdown for Claude, HTML for the human, playground for the user-doing-something.**
