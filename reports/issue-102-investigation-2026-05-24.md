# Investigation Report: HTML Structuring for Toolkit Files

**Issue:** [#102](https://github.com/mayankmankhand/llm-peer-review/issues/102)
**Mode:** Vision (re-run, fresh eyes)
**Status:** Investigation report. Recommendations only. No code changes in this issue.
**Date:** 2026-05-24

---

## TL;DR

Long markdown files in this toolkit get approved without being read. HTML can fix that, but only when it actually changes how the user engages with the output. The principle: **markdown stays canonical for Claude to read; HTML is a rendered view for the human, generated either by default for predictable cases or by Claude's judgement for variable cases**. Recommend four sub-issues, foundation-first.

---

## Core Principle (the Reader/Claude line)

Three rules govern format:

| What | Format | Why |
|---|---|---|
| Outputs Claude reads later (`CODEBASE_MAP.md`, `PLAN-*.md`, shared templates, command/skill prompts, rules) | **Markdown, always** | Claude parses markdown reliably; HTML is wasted tokens for re-ingestion |
| Outputs the user reads (review reports, plan progress, debate summaries, cycle summaries, explainers) | **Markdown by default, HTML when (a) the command is on the default-on list, or (b) Claude judges it adds value** | Most outputs stay markdown for speed; HTML is reserved for moments where scan-ability or comparison genuinely change the experience |
| Outputs the user *does something with* (compare options, drag/order, tune values, click through) | **HTML playground (interactive)** | Static markdown cannot support the loop |

When Claude generates HTML, it announces upfront: *"Generating an HTML view because [reason]. Say 'skip HTML' if you want markdown only."*

---

## Default-on vs Claude's Judgement

### Default-on (HTML always generated, no judgement call)

Three commands, where HTML adds value almost every time:

| Command | Why default-on |
|---|---|
| `/codebase-to-course` | Already HTML today. No change. |
| `/create-plan` | Plans are always long. Dual-track (markdown canonical + HTML view) is always worth it. |
| `/document` cycle summary | One-page HTML "what shipped this cycle" runs every time `/document` does. |

### Claude's judgement (HTML when it adds value)

Everything else. Claude decides per-output and tells the user why.

| Command | When HTML fires |
|---|---|
| `/review` family (all 8 specialists) | Findings count is 3+, OR there's visual evidence (browser screenshots), OR severity mix benefits from color-coded scanning |
| `/explore` vision-mode summary | 2+ options are being compared (side-by-side card layout) |
| `/ask-gpt`, `/ask-gemini` | Debate had substance (3+ rounds with real back-and-forth, or 3+ Recommended Actions) |
| `/peer-review` | Paired with a long debate; otherwise stays markdown |
| `/learning-opportunity` | Concept benefits from collapsible 3-level depth, or is interactive in nature |
| `/pair-debug` | Long sessions only (3+ hypotheses, 3+ checks) |

---

## Where HTML Adds Real Value (touchpoint table)

Maps your explicit asks (visualize during exploration, selective review flagging, /document summary) to the existing toolkit surface.

| Command | Problem with markdown today | HTML treatment | Thariq pattern |
|---|---|---|---|
| `/create-plan` | 100-300 line plans get scrolled past. Decisions, data flow, mockups, risks flatten into prose. | Dual-track: markdown canonical, HTML view in the browser. Timeline, mockups, code blocks, risks table, status badges per task. Default-on. | Demo 16 (implementation plan) |
| `/document` cycle summary | "What shipped this cycle" doesn't exist today; doc updates scatter across files. | One-page HTML at the end of `/document`: shipped items, README/CLAUDE/CHANGELOG/LESSONS deltas, PR link, small commit chart. Default-on. | Demo 11 (status report, with inline SVG instead of ASCII chart) |
| `/review` and `/review-*` | 4-field finding format flattens into prose. Severity buried in emojis. Specialist tags are inline `[code]`. | When Claude judges: color-coded severity badges, file:line links, expandable Why/Example/Fix panels, specialist-tag chips, sticky Top Issues header. Skip for 1-2 findings. | Demo 03 (PR review with risk badges, inline annotations, color severity) |
| `/explore` vision-mode options | Closing summary is text only. 3-4 options can't be compared at a glance. | Side-by-side option cards (live UI preview if visual, code/text panel if not). Generate only when 2+ options. | Demo 02 (4 visual designs side-by-side), Demo 01 (3 code approaches with pro/con) |
| `/ask-gpt` + `/ask-gemini` summaries | Lead Reviewer Summary mixes everything. Long debates produce a wall of text. | Side-by-side HTML: Claude vs model positions per round, then synthesis. Otherwise markdown. | Demo 14 (collapsible sections) for synthesis, Demo 02 layout for round-by-round |
| `/peer-review` verdict | Verdict table loses visual contrast between Confirmed and Dismissed. | When paired with long debate: two-column layout (Confirmed left with severity colors, Dismissed right with evidence). Otherwise markdown. | Demo 03 (color severity) + Demo 17 (file-by-file with margin notes) |
| `/learning-opportunity` | 3 depth levels are sequential text. Users wanting "just Level 1" still scroll past 2-3. Interactive concepts stay theoretical. | When Claude judges: HTML explainer with 3 depth tabs (collapsed by default). Interactive concepts get a playground (delegated to playground skill). | Demo 14 (feature explainer), Demo 15 (concept with interactive ring) |
| `/pair-debug` hypothesis tree | H1/H2/C1/C2 work in chat but multi-level investigations get confusing. | Optional HTML decision tree for long sessions. Click a node to expand evidence/result. | Demo 13 (clickable flowchart) |
| `/codebase-to-course` | Already produces HTML. | No change. | Already aligned |

---

## Where HTML Does NOT Add Value

| Command / File | Stays markdown | Why |
|---|---|---|
| `CODEBASE_MAP.md` | Yes | Generated for Claude. User confirmed they would not view it. |
| `README.md`, `SETUP.md`, `API-KEYS.md`, `AGENT-SETUP.md`, `CONTRIBUTING.md`, `DEMO-SCRIPT.md` | Yes | GitHub renders these natively. HTML loses GitHub rendering. |
| `CLAUDE.md`, `LESSONS.md`, `.claude/rules/*.md` | Yes | Read by Claude every session. Markdown is canonical. |
| `.claude/commands/*.md`, `.claude/skills/*/SKILL.md` | Yes | Prompt files. Claude reads them at runtime. |
| `CHANGELOG.md` | Yes | Per-release notes. GitHub-native. |
| `/create-issue` | Yes, no HTML preview | User confirmed no preview needed. Issues are markdown on GitHub. |
| `/worktree` | Yes | Small printed setup summary, not a document. |
| `/index` | Yes | Generates CODEBASE_MAP.md which is for Claude. |
| `/package-review` | Yes | Bundles code for paste-into-another-AI. Markdown is what those AIs want. |
| `/execute` | Yes | Updates plan markdown in place. HTML re-renders only at end-of-plan, not per-step. |

---

## The Playground Skill

A new skill `.claude/skills/playground/SKILL.md` that builds throwaway interactive HTML files. User-invokable (`/playground`) and agent-discoverable (other commands dispatch it when an option set genuinely benefits from interaction).

### Shape

- User says (or another command says): *"Use the playground skill to help me compare these three onboarding flows"*
- Claude generates a self-contained HTML file at `/tmp/playground-{timestamp}.html`
- The HTML supports the specific interaction needed (drag, toggle, slider, side-by-side compare, click-to-expand)
- The HTML **always ends with a "copy as markdown" or "copy as prompt" button** - this is the export loop: the button emits text the user pastes back as a new chat message. The HTML never modifies any toolkit file (your explicit constraint)
- Claude opens the file in the user's browser

### When other commands dispatch the playground

| Caller | When |
|---|---|
| User direct | Anytime they want an interactive artifact |
| `/explore` (vision mode) | When 2+ options need side-by-side, draggable, or toggleable comparison and static HTML cards aren't enough |
| `/create-plan` | When deciding between architectural alternatives that need to be felt |
| `/learning-opportunity` | When the concept is interactive in nature (e.g., state machines, hashing, retries) |
| `/pair-debug` | Rare. Reproducing an interactive UI bug |

### Hard rules

1. The HTML never reads back into the toolkit. Output is text the user pastes manually. No file modifications to any prompt file, skill file, or rules file.
2. Static-default for invocation pattern. Interactivity (click handlers, sliders) only when it changes the decision.
3. Disposable. Lands in `/tmp/`. Never in the repo. Never gitignored (because never in the repo).
4. Self-contained. One HTML file, inline CSS/JS, no CDN. Works offline.

### What the playground skill is NOT

The skill is a generic capability. It does NOT ship pre-baked editors. The user explicitly dropped ticket triage boards, feature flag editors, and prompt tuners as use cases. Any future playground use case emerges from a real conversation, not a template library.

---

## Downstream-Project Patterns

The toolkit installs into downstream projects, and those projects may be UI products with design systems, component libraries, or motion-heavy interactions. Thariq's patterns that don't apply to the toolkit itself can still apply when toolkit commands operate on a downstream project's UI work.

| Thariq pattern | When downstream-project work hits it |
|---|---|
| Design system swatches (Demo 05) | `/review-ux` on a UI project with tokens; `/explore` for a redesign |
| Component variants matrix (Demo 06) | `/review-ux` reviewing component library work; `/create-plan` for a component refactor |
| Animation prototype (Demo 07) | `/explore` for a micro-interaction; `/review-ux` for motion review |
| Drag-to-reorder prototype (Demo 08) | `/explore` for an interaction design; `/review-browser` for QA |

The shared HTML look reference (Sub-Issue A below) includes guidance that these patterns exist and when to reach for them. No new skills required per pattern. The playground skill plus the shared look cover all four when needed.

**Explicitly dropped:** ticket triage board (Demo 18), feature flag editor (Demo 19), prompt tuner (Demo 20). User confirmed these are not relevant for this toolkit or for downstream projects.

---

## Sub-Issue Decomposition (4 issues, foundation-first)

Order is dependency + priority. Work top to bottom, close as you go.

### Sub-Issue A (priority-high): HTML Output Rule + Shared Look Reference

Foundation. Nothing else lands without this.

**Deliverables:**
- `.claude/rules/html-outputs.md` - the one-page rule file codifying the Reader/Claude principle, the default-on vs judgement split, the playground export-loop rule, naming conventions for HTML artifacts, where they live (`/tmp/` for throwaways, `artifacts/html/` for cycle-bound artifacts like plan renders)
- `.claude/skills/shared/html-look.md` - shared reference for the visual look: typography scale, color tokens, severity badge colors matching the existing 🚫⚠️💡 scale, spacing rules, the "copy as markdown" button pattern, guidance for downstream-project patterns (swatches, variants, animation, drag). Inlined into commands/skills via `` !`cat` `` the same way `output-template.md` is today
- `.gitignore` updates for `artifacts/html/`
- `scripts/setup/setup.sh` + `setup.ps1` propagation of the new rule + shared file
- `scripts/setup/bump-version.sh` stamps the new rule file's version comment
- `.claude/rules/toolkit.md` updated to reference the new rule file in one line

**Validation before closing:** dry-run propagation test (fresh setup install lands both files; re-running setup is idempotent).

---

### Sub-Issue B (priority-high, can run parallel to A's tail): Playground Skill

Self-contained new capability. Ships parallel value (users can play with playgrounds the day this lands).

**Deliverables:**
- `.claude/skills/playground/SKILL.md` (new) - skill definition with frontmatter (`name`, `description`, `allowed-tools`)
- "Use this when / Don't use this when" guidance
- The four hard rules listed in the Playground Skill section above
- Generic invocation patterns (side-by-side compare, slider, toggle, click-to-expand). No specific use-case examples; emergent from real conversations only.
- Update `.claude/rules/toolkit.md` command table
- Update `.claude/settings.local.json` permissions if any new Bash patterns are needed (likely none, since Claude writes HTML directly via Write tool)

**Validation before closing:** invoke `/playground` manually and confirm the export-loop button works (paste back into chat closes the loop without modifying any toolkit file).

---

### Sub-Issue C (priority-medium): First wave of HTML output (plans + reviews)

The two highest-volume outputs. After C, the user feels the value daily.

**Deliverables:**

**C1: `/create-plan` HTML (default-on)**
- `/create-plan` produces `PLAN-*.html` alongside `PLAN-*.md`
- Markdown is canonical (Claude reads it, `/execute` updates it)
- HTML re-renders at plan creation and at `/execute` end-of-plan (not per-step)
- Both land in `plans/` (already gitignored)
- HTML uses shared look from A: timeline, mockups, code blocks, risks table, status badges per task

**C2: `/review` family HTML (Claude's judgement)**
- `/review` and all `/review-*` (review-code, review-ux, review-browser, review-plan, review-full, review-deps, review-copy, review-commands) optionally produce HTML alongside markdown report
- Claude judges per the criteria above (3+ findings, OR visual evidence, OR severity mix benefits from color)
- Markdown report stays in `reports/` (today's behavior). HTML report lands in `artifacts/html/` (new).
- 4-field finding format from `output-template.md` maps to HTML cards. Specialist tags become chips. Browser evidence becomes inline expandable panels.
- `/peer-review` follows the same pattern: HTML verdict when paired with a long debate, markdown otherwise

**Validation before closing:** generate a plan and a review, open both HTML files in a browser, confirm severity colors, file:line links, and Top Issues sticky header all work.

---

### Sub-Issue D (priority-medium): Second wave (explore + debate + document + optional follow-ups)

Completes coverage. Smaller per-command lift since the shared look (A) and patterns (C) are established.

**Deliverables:**

**D1: `/explore` vision-mode options HTML (Claude's judgement)**
- When the closing summary has 2+ options being compared, generate side-by-side HTML
- Lands in `artifacts/html/explore-{topic}-{timestamp}.html`
- Includes scope-dial outcome and key decisions inline

**D2: `/ask-gpt` + `/ask-gemini` summary HTML (Claude's judgement)**
- When the debate had substance, Step 6 also generates HTML alongside markdown
- Side-by-side layout: Claude positions vs model positions per round, plus synthesis
- Lands in `artifacts/html/debate-{model}-{session-id}.html`

**D3: `/document` cycle summary HTML (default-on)**
- Add a final step to `/document` that generates a one-page HTML summary
- Contents: files changed by category, README/CLAUDE/CHANGELOG/LESSONS deltas, PR link, mini commit-activity chart for the cycle
- Lands in `artifacts/html/document-{date}.html`
- Skip generation if zero meaningful changes (e.g., a docs-only typo fix)

**D4 (optional, deferrable): `/learning-opportunity` HTML explainer (Claude's judgement)**
- HTML with 3 depth tabs (collapsed by default) when the concept is rich
- For interactive concepts, delegate to playground skill instead of building static HTML

**D5 (optional, deferrable): `/pair-debug` HTML hypothesis tree (Claude's judgement)**
- Clickable flowchart for long debug sessions (3+ hypotheses)

**Validation before closing:** run one of each of D1/D2/D3 end-to-end, confirm files open in a browser correctly.

---

## Where This Converges With Attempt 1

- The Reader/Claude principle and which files fall on each side
- Dual-track for plans (markdown canonical, HTML rendered)
- HTML for review reports, debate summaries, exploration outputs, `/document`
- Foundation-first ordering (shared look + rules before per-command work)
- Gitignored artifacts directory
- Dropping ticket triage, feature flag editor, prompt tuner

## Where Fresh Eyes Diverged From Attempt 1

- **Playground as a first-class skill** (attempt 1 dropped this whole bucket; user explicitly asked for it)
- **Generic playground skill, not three pre-baked editors** (attempt 1 evaluated the three editors individually and dropped all three; this report proposes one skill that can produce any playground when called)
- **`/document` is a one-page HTML, not a deck** (per user correction)
- **Downstream-project patterns explicitly preserved** as a category (attempt 1 didn't call out that design system swatches, component variants, animation, drag prototypes from Thariq apply to UI projects the toolkit operates on)
- **Hybrid default-on vs judgement, not dual-track-always** (3 default-on commands, rest judgement; attempt 1 was closer to always-on for the listed commands)
- **Four sub-issues, not six** (smaller decomposition reduces tracking overhead; first-wave bundles plans+reviews, second-wave bundles explore+debate+document)
- **No HTML preview for `/create-issue`** (user confirmed)
- **`/learning-opportunity` HTML treatment surfaced** (attempt 1 seemed to omit it; this report includes it as optional D4)

---

## Out of Scope (explicitly dropped)

- Incident report HTML
- PR writeup HTML (GitHub renders markdown natively, no win)
- CODEBASE_MAP HTML viewer (file is for Claude)
- Deck format (replaced with one-page HTML for `/document`)
- Ticket triage board, feature flag editor, prompt tuner (any form)
- HTML for any prompt file, rules file, or `CODEBASE_MAP.md` (Reader/Claude principle)
- Implementation work of any kind (this issue is investigation-only)

---

## Open Questions for Next Session

These don't block sub-issue creation; they're decisions to make as A is built.

1. **File naming.** Proposed: `.claude/rules/html-outputs.md` for the rule, `.claude/skills/shared/html-look.md` for the shared visual reference. Names are negotiable.
2. **Artifacts directory location.** Proposed: `artifacts/html/` at project root. Alternatives: `.claude/artifacts/html/` (inside toolkit dir) or `tmp/html/` (more ephemeral signal). Pick during Sub-Issue A.
3. **Color tokens for severity badges.** The shared look needs concrete hex values for 🚫 / ⚠️ / 💡. Defer to design choice during A.
4. **`/learning-opportunity` HTML - in or out of D's first cut?** Currently flagged as optional D4. Could ship in D's first cut if interactive explainers feel important now; could defer to a follow-up issue if not.

---

## Summary

- **Principle:** Markdown for Claude, HTML for the human, playground for the user-doing-something.
- **Default-on:** `/codebase-to-course`, `/create-plan`, `/document` cycle summary.
- **Claude's judgement:** everything else where HTML is appropriate.
- **New skill:** `/playground` (generic, throwaway, export-loop required).
- **Sub-issues:** four, ordered A (foundation), B (playground), C (plans + reviews), D (explore + debate + document).
- **Out of scope:** all of attempt 1's three editor playgrounds, incident reports, PR writeups, CODEBASE_MAP viewer, decks, any implementation work.

End of report.
