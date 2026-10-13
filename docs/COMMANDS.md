# Commands

How each command in the LLM Peer Review toolkit works, the two brakes on the loop, which review command to use, and how the debates run. The full command table, including every review skill, is in the shipped manual: [toolkit-reference.md](../.claude/skills/shared/toolkit-reference.md), under Slash Commands. On the plugin every command below carries the `tk:` prefix (`/tk:explore`); the copy-install uses the bare names shown here.

## The loop and its two brakes

You don't have to use every command every time. Following the order prevents the most common mistake: coding before you've thought it through.

**Two ways to take back control, and they do different things.** Say **"no chaining"** to stop the *handoff*: that run finishes its own stage and does not start the next one. Say **"report only"** to stop the *changing*: the run tells you what it found and edits nothing. They are deliberately separate, so you can have either without the other, and both last for one run only. One thing to know about a chained cycle: the review that follows `/execute` starts on its own, so there is no moment to type "report only" for it. If you want that review to change nothing, say "no chaining" when you approve the plan, then type `/review <start>..HEAD report only` yourself, with the `Start commit` sha `/execute` wrote at the top of the plan (a plain `/review` on a clean tree covers the plan's own commits while any of them are unpushed, else your newest 20 unpushed commits).

> **Want to see this in action?** Follow the 5-minute walkthrough in **[DEMO-SCRIPT.md](../DEMO-SCRIPT.md)**.

> **Working on multiple things at once?** Use `/worktree` first to create an isolated copy, then open it in a new Cursor window and run `/explore` there. When the PRs are ready, `/merge` lands them, checked for lost work.

---

## How key commands work

These commands carry most of the workflow. Each has its own prompt file with the full prompt (under `.claude/commands/`, or `.claude/skills/` for the ones that are skills, like `/error-analysis`); the summaries below are the "what is this, when do I use it" view.

### `/explore` - Understand before you build

Asks 3-4 focused questions about scope, success criteria, and constraints before any code is written. Has two modes: **scoping** (you have a concrete idea, pressure-test the scope) and **vision** (you're thinking big-picture, challenge the premise itself). It picks a mode by reading your input, then asks you to confirm. You can switch modes any time. Useful when you're not yet sure what you're actually building. When the conversation converges (no open questions left, and in vision mode a scope dial reading Hold or Reduce), it hands off to `/create-plan` on its own.

**Models: best, fit or cheap.** Alongside its first questions, `/explore` asks how this cycle's helpers run: the review helpers are the specialists `/review` sends out, the map helper is the agent `/index` uses to build the codebase map, and your session model is the one this Claude Code session runs on. **Best** puts the review helpers on your session model and keeps the map helper on Sonnet, the model it was tested on. **Fit**, the default, uses the measured settings (review helpers on Opus, the map helper on Sonnet), never above your session model. **Cheap** puts them on Sonnet: cheaper, but in the toolkit's planted-bug test the Sonnet review helpers missed a bug the Opus ones caught. The judges (the audit, the fix check, the plan and design critics) run on your session model in every mode. `/create-plan` writes the answer into the plan as its `**Models:**` line, and a `mode:` word on `/review` or `/index` (`/review mode:cheap`) changes it for one run. Details: [`.claude/skills/shared/model-routing.md`](../.claude/skills/shared/model-routing.md).

**The design workflow.** When the feature has a look (a page, a screen, a component), `/explore` runs a named "Design exploration" step. It checks whether your repo already has a design system and asks you once, then sets a load level: nothing to design, improve something that exists, or build something new. New work gets an idea list you react to, three seeded working prototypes side by side to pick from, and then, during `/execute`, a design loop of up to five rounds (two when improving something that exists). Each round a fresh-context critic names the biggest gaps, a quick browser pass checks that typing and clicks survive the page redrawing, and a blind judge compares the new version with the one before, shown both ways round. The loop goes on while the new version wins both times. If it loses both times, the round's design changes are undone and the loop stops; a mixed result stops the loop and keeps the new version. The gaps the loop leaves open go to `/review` as must-check items instead of being lost. A repo that already has a design system keeps it: only layout, composition, motion, and copy vary, and anything further asks you first. Your repo's answers live in `DESIGN-PROFILE.md`, a file that is yours (seeded once by setup, never overwritten). Image and video generation are optional and sit behind your own keys; without a key the workflow hands you the prompt to run elsewhere and continues. The rules live in [`.claude/skills/shared/design-rules.md`](../.claude/skills/shared/design-rules.md); the keys are covered in [API-KEYS.md](../API-KEYS.md#media-generation-optional).

Full prompt: [`.claude/commands/explore.md`](../.claude/commands/explore.md)

### `/create-plan` - Turn an idea into trackable steps

Produces a `plans/PLAN-*.md` file with status emojis (🟥 To Do, 🟨 In Progress, 🟩 Done) and a progress percentage at the top. Tags each step `[parallel]` or `[sequential]` so `/execute` knows what can run concurrently. Captures critical decisions and (for UI features) the design choices made during `/explore`. Before you see it, a fresh-context plan critic lists its biggest gaps (no score, just the gaps) and they get fixed; the gaps from its second look are carried to `/review` as must-check items, unless the plan is right to leave them open (decided with you, or out of scope). The plan becomes your single source of truth for the feature. It runs on its own after `/explore` converges, then **stops and waits for you** - approving the plan is the one human gate in the cycle, and nothing gets built until you say go. A fit or cheap plan is built on Opus: when your session already runs on Opus, "go" starts the build there; otherwise the plan's closing message gives the steps for a fresh Opus session, because switching models inside the conversation would re-read everything uncached, which costs more than starting over.

Full prompt: [`.claude/commands/create-plan.md`](../.claude/commands/create-plan.md)

### `/execute` - Build it, update the plan as you go

Walks through the plan step by step, updating status emojis and progress in real time. Spawns parallel agents for `[parallel]` steps, runs `[sequential]` steps in order. Small failures get at most 3 fix attempts per step. Stops on critical blockers (e.g. the plan assumed an API supports a feature it doesn't) instead of pushing through a broken plan. A step is green only when the project's tests pass: `npm test` or `pytest` by default, or exactly the checks in your `.claude/toolkit/checks.json` when that file exists, run through the toolkit's checks runner (`run-checks.js`), which saves the log and reads back only the failing lines; npm's stock placeholder script counts as no tests, and a failed or refused check turns the step red. On a clean finish it hands off to `/review`; on a blocker it stops there and asks you.

Full prompt: [`.claude/commands/execute.md`](../.claude/commands/execute.md)

### `/review` - Auto-detect what changed, run the right specialists, fix what they confirm

Looks at what changed (the commits `/execute` made, which it hands over as a range, plus anything uncommitted) and dispatches the relevant review skills (`/review-code`, `/review-security`, `/review-ux`, `/review-plan`, `/review-browser`, `/review-deps`, `/review-copy`, and others) in parallel. Typed with no range, it takes the newest plan's own commits while any of them are unpushed, else your unpushed commits, and the report opens by naming that range and why it chose it. Before you read anything, the combined findings pass a three-tier audit: every finding ships with a receipt (a runnable check, like a grep or a test) that the toolkit's checks runner (`run-checks.js`) executes from your project root and judges by machine (read-only commands only; a check it refuses fails the receipt), survivors face a fresh skeptic whose default is to refute, and Block-severity findings must survive a three-skeptic vote. The plan's must-check items (gaps the plan or design critics left open) go through the same audit, so each one is either confirmed or dismissed with proof. The report shows only the survivors. Each finding is one sentence carrying the defect and its harm, a second only when it says who is hit or when it fires, and a fix line that states a cost, with the check that proves it attached. Everything the audit killed is listed one line each in an "Audited out" log, never fixed. Survivors are then fixed automatically, and each fix is re-verified (max 2 rounds) instead of assumed done - the run ends with a summary showing, for every fix, the check that proves it worked. Once the loop settles it hands off to `/document`, which finishes the cycle: docs updated, commits made, and (behind a secret-scanning tripwire) pushed. Your control points: you approved the plan before anything was built, the loop stops and asks whenever a decision genuinely needs a human (for example, edits to the toolkit's own prompt files), and two per-run phrases give you the wheel back - "report only" reports findings without changing anything, "no chaining" stops the handoff to the next stage.

Directly-typed `/review-*` runs are audited the same way before their reports - expect a few extra sub-agents (a skeptic per 7 findings, plus three voters for Block-severity findings) after the review itself, announced before they run. Loop rules: `.claude/skills/shared/hitl-loop.md`.

Full prompt: [`.claude/commands/review.md`](../.claude/commands/review.md)

### `/merge` - Land finished worktree PRs without losing work

When several worktrees run at once, each branch is blind to what lands on main after it was cut. A conflict fixed while landing one of them can quietly drop work it never saw, or its own work, and a squash merge hides the fix. `/merge 241 242` lands PR #241 and then PR #242, in the order you give, one at a time. For each one it brings the branch up to date with main and fixes the conflicts (the lessons files keep both sides, generated files are rebuilt, the changelog block goes back where new entries go), then lands it only when four checks pass:

- your tests (your `checks.json`, or `npm test` or `pytest`);
- **nothing other work added after the cut is removed** (rule 1);
- **every line the PR added makes it in** (rule 2);
- **no decision contradicts one that landed after the cut** (rule 3): a fresh reviewer compares this PR's decisions with theirs, even across files, so "go right" in one PR and "always go left" in another's guide is caught.

All four key on the branch's **cut point**, the commit it was cut from, which `/worktree` records when it makes the branch. Git's merge-base cannot stand in for it: once a branch is updated from main, the merge-base moves past every line the branch never saw. `/document` writes the cut, the plan's decisions and the changelog block into the PR, and the landing commit repeats them, so they survive a squash and a deleted worktree.

**What stops it.** The first flag, failing test or contradiction stops that PR before anything lands, and tells you in plain English what would be lost and who wrote it. You choose: Claude fixes it, you keep it on purpose, or you stop.

**Keeping a removal on purpose.** Sometimes removing a line is right. Say "keep it" and the landing commit records `Kept on purpose: <sha> <file>: <line>`; after the fact, an empty commit on main carrying the same line does the same. The record names the commit that wrote the line, so the same text written by another commit is still checked.

**How it lands.** It follows your repo's habit: a merge commit made on your machine (nothing is pushed), or the host's merge or squash through `gh` or `glab`, which asks first and is refused by the host if the PR moved after the checks. Rebase merges are not offered: a rebase leaves no landing commit to carry the record, so a rebase habit lands as a squash.

**Landings made another way.** Each run first checks every landing since its last run, so a PR merged with the host's merge button is still checked, one step later. A squash made with the button is checked only when its PR carries the `Cut from:` line `/document` writes, and then only for other work it removed: a squash keeps no branch to compare its own lines against. A rebase made with the button is listed as not checkable, and a squash made with GitLab's button looks like an ordinary commit and is not seen.

It is human-triggered and never chained into: which PR lands first is your call.

Full prompt: [`.claude/commands/merge.md`](../.claude/commands/merge.md) | Rules: [`.claude/skills/shared/merge-rules.md`](../.claude/skills/shared/merge-rules.md)

### `/ask-gpt` and `/ask-gemini` - Debate with another AI

Run a structured debate of up to 3 rounds between Claude and ChatGPT (or Gemini). They push back on each other, concede points, and produce a structured verdict: Agreed / Disagreed / Recommended Actions. Recommended Actions use the same two-sentence finding contract as `/review` (one sentence carrying the defect and its harm, a second only when it says who is hit or when it fires, and a fix line that states a cost), so the output model is consistent across all peer-review surfaces. Each debate typically costs $0.01-$0.10 in API credits. Requires API keys from OpenAI and/or Google AI Studio. See [API-KEYS.md](../API-KEYS.md) for setup.

Full prompts: [`.claude/commands/ask-gpt.md`](../.claude/commands/ask-gpt.md) | [`.claude/commands/ask-gemini.md`](../.claude/commands/ask-gemini.md)

### `/error-analysis` - find out what you keep correcting

Every time you step in during a cycle, correcting Claude or asking for something different, `/document` records it as one row in a ledger with a short note in your own words about what went wrong. `/error-analysis` reads those notes across every cycle, groups them into categories, counts them, and ranks them, so the thing you fix is the one that actually keeps happening rather than the one that happened most recently. It refuses to rank on fewer than ten rows, because a ranking built on two data points is the exact mistake it exists to prevent.

Everything is recorded at `~/.claude/correction-ledger.jsonl`, per machine, outside every repo, so you can open it and read exactly what is stored. A row holds your note plus four private fields: what you had asked, what Claude produced and what was wrong (each capped at 300 characters), and your own rewrite of what you wanted, when you wrote one (capped at 1,200). Those never leave your machine: they are excluded from every summary by construction, only a session opened in the repo they came from can read them back (the fix loop's evidence step below), and this command never publishes and never sends anything to another model. To stop future capture in a repo, `touch .claude/.no-correction-log`. That records nothing further; rows already written stay until you delete the file yourself. For a test run that should not touch your real ledger, set `TK_LEDGER_DIR` to an absolute folder: the ledger and its other files are then written there, while capture still reads your real session transcripts.

Each category also gets a home, the place its fix belongs, worked out from how widely it spreads. A category seen in one repo belongs in that project's own files. One seen in several repos belongs in your global instructions file (`~/.claude/CLAUDE.md`), unless most of its rows came up during the toolkit's own stages (`/explore`, `/create-plan`, `/execute`, `/review` and `/document`); then it belongs in the toolkit itself.

When you act on one, the fix loop reads that category's rows from inside the repo they came from, drafts the fix for its home, and waits for your approval. A global or toolkit fix is written in generic words. A toolkit fix leaves its repo only as a generic note you approve, which is filed as an issue in the toolkit's GitHub repository.

Once a fix lands you record it, and later rankings show the category's rate per `/document` cycle before and after it; a change counts as real only once each side has at least five cycles. Rows recorded before the request and rewrite fields existed can have them filled in from transcripts still on disk, when you ask, without adding any row.

Full prompt: [`.claude/skills/error-analysis/SKILL.md`](../.claude/skills/error-analysis/SKILL.md)

### `/create-issue` - issues that don't bloat

Asks 2-3 clarifying questions first, then creates a short (10-15 line) issue via `gh issue create` on GitHub or `glab issue create` on GitLab. It picks the right one by reading your git remote, so there is nothing to configure. No implementation details; that's what `/explore` and `/create-plan` are for. Good for capturing bugs and ideas without context-switching out of your editor.

Full prompt: [`.claude/commands/create-issue.md`](../.claude/commands/create-issue.md)

---

## Which review command do I use?

| I need to... | Use |
|---|---|
| Check code for bugs, logic, and quality | `/review-code` |
| Security-check a code change (injection, secrets, XSS, ...) | `/review-security` (auto-runs inside `/review`) |
| Check dependencies/packages for known vulnerabilities (CVEs) | `/review-deps` |
| Deep whole-repo security audit (auth, secrets, crypto, history) | `/security-audit` |
| Review slash command prompts and workflows | `/review-commands` |
| Verify implementation matches a plan | `/review-plan` |
| Evaluate UX, accessibility, and user flows | `/review-ux` |
| QA a running web app via headless browser | `/review-browser` |
| Check if copy is clear to a fresh reader | `/review-copy` |
| Pre-release go/no-go check across all domains | `/review-full` |

---

## How `/ask-gpt` and `/ask-gemini` Work

`/ask-gpt` and `/ask-gemini` run an automated debate between Claude and another AI about your code or plan. You don't have to copy anything manually; the toolkit handles the whole loop. A debate runs up to 3 rounds - if both models fully agree after round 2, it ends early instead of running a third.

### Example

```
You: /ask-gpt

Claude: What would you like me to review?
        1. Plan    2. Code    3. Branch    4. Feature    5. Other

You: Review the auth middleware

Claude: [Gathers context → sends to ChatGPT → they debate up to 3 rounds]

        --- Summary ---
        Agreed: Add token expiry check, extract magic numbers

        Recommended Actions:
        - [ ] Add token expiry validation
        - [ ] Move 3600 to TOKEN_EXPIRY_SECONDS

        Want me to implement these?

You: Yes
```

Want a different perspective? Run `/ask-gemini` next.

> **API costs:** Each debate (up to 3 rounds) typically costs $0.01-$0.10 in API credits depending on context size. You'll need an OpenAI and/or Gemini API key with credits. See **[API-KEYS.md](../API-KEYS.md)** for a step-by-step setup guide.

**Choosing what to review:**

<img src="images/ask-gpt-prompt.png" alt="ask-gpt prompt showing review options" width="700">

