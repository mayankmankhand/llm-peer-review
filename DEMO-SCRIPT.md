# Demo Script - LLM Peer Review Toolkit

**Total time:** ~5 minutes
**Sample task:** Add a `/hello` command that greets the user
**Prerequisites:** Claude Code installed, API keys configured (OpenAI for `/ask-gpt`), clean git state

> **Formatting guide:**
> - **SAY** = what to tell the audience
> - **TYPE** = what to type in the terminal
> - **WAIT** = pause for output before continuing
> - **TIP** = fallback if something goes wrong

---

## 1. Intro (~30 seconds)

**SAY:**
> This is the LLM Peer Review Toolkit. It gives you a structured workflow for building features with AI - from exploring the problem, to planning, building, reviewing, and getting a second opinion from another AI model.
>
> The whole flow is driven by slash commands. I'll walk through all of them using a simple task: adding a `/hello` command to this project.

---

## 2. Explore (~60 seconds)

**SAY:**
> Every feature starts with `/explore`. It asks you questions about scope, goals, and edge cases before you write any code.

**TYPE:**
```
/explore Add a /hello slash command that greets the user by name
```

**WAIT** for Claude to ask "Scoping or vision? [scoping]" first - answer `scoping` (or just confirm the default). Then it asks the scoping questions (2-4 questions).

**SAY:**
> See how it's asking about scope, success criteria, and edge cases? This is the "think before you build" step. I'll give quick answers to move things along.

**TYPE** answers to the scoping questions. Keep them short:
- Scope: just a simple greeting command, nothing fancy
- Success: the command prints "Hello, [name]!" when you run `/hello [name]`
- No UI needed

**TIP:** If Claude asks many rounds of questions, say "looks good, let's move to planning" to speed things up.

---

## 3. Create Plan (~45 seconds)

**SAY:**
> Now that Claude understands the feature, the plan writes itself - I don't type anything here. Once the exploration has converged, `/create-plan` fires on its own. This produces a markdown file with tracked steps, so you always know where you are.

**WAIT** for `/create-plan` to fire on its own, then for the plan to be generated. An HTML view of the plan is published to a private Claude-hosted page and the link appears in chat; when the session cannot publish, it opens in your default browser instead. Either way that is expected, not a glitch.

**SAY:**
> Notice the plan has status emojis, a progress percentage, and clear steps. This becomes your single source of truth for the feature. And that plan page, whether it arrived as a link in chat or opened in a tab? That's the same plan rendered as HTML, so you can scan it without reading raw markdown.

**TIP:** If the plan is long, just highlight the Tasks section and move on. If a browser tab opened and steals focus, drag it next to the terminal - it makes a nice split-screen for the rest of the demo.

---

## 4. Execute (~60 seconds)

**SAY:**
> Now we build. `/execute` follows the plan step by step, updating the status as it goes.

**TYPE:**
```
/execute
```

**WAIT** for Claude to build the `/hello` command.

**SAY:**
> It's writing the command file, updating the plan to show progress, and it'll stop when it's done. Every step gets a green checkmark as it completes.

**TIP:** If execution takes longer than expected, narrate what's happening on screen: "It's creating the command file now... updating the plan..."

---

## 5. Review (~45 seconds)

**SAY:**
> Before we ship anything, we review - and again I don't type it. `/review` chains straight from `/execute`. It finds issues, double-checks which ones are real, fixes those, and then re-checks every fix it made. If I want it to look without touching anything, I say "report only" on the run - that opt-out applies to the run it is said on.

**WAIT** for `/review` to chain from `/execute` and produce its report.

**SAY:**
> `/review` auto-detects what changed and dispatches the right specialist reviews. You get the written report - bugs, style issues, suggestions - then it fixes the confirmed ones and re-checks each fix, ending with a summary that shows the proof behind every change. My control points are the same ones you have already seen: I approved the plan before we built, and the toolkit stops and asks when a decision needs a human. Two phrases give me the wheel back: "no chaining" stops it handing off to the next stage, and "report only" means it tells me what it found without changing anything.

**TIP:** If the review is clean (no issues), say: "A clean review is great - but the point is that it always checks before changing anything." If the review finds 3+ issues, an HTML report may appear as a link in chat, or open in the browser if this session cannot publish - narrate it as the rendered view of the same findings.

---

## 6. AI Peer Review (~45 seconds)

**SAY:**
> Here's where it gets interesting. We send our work to ChatGPT for a debate with Claude - up to 3 rounds. They push back on each other, concede points, and produce a structured verdict.

**TYPE:**
```
/ask-gpt
```

**WAIT** for the debate to run (this takes 30-60 seconds).

**SAY** (while waiting):
> This is running up to 3 rounds of back-and-forth. ChatGPT reviews the work first, then Claude responds as the author - accepting some points, pushing back on others. ChatGPT follows up, and they go back and forth for up to 3 rounds (if they fully agree after round 2, it ends early). At the end you get a summary of what they agreed on, where they disagreed, and a prioritized action list.

**TIP:** If the API is slow, keep narrating: "The models are debating right now - you'll see the rounds appear as they complete." If it errors, say: "In a real session you'd retry - the output is a structured verdict with agreed/disagreed/actions." When the summary has 3+ recommended actions, an HTML view of the debate may appear as a link in chat, or open in the browser if this session cannot publish.

---

## 7. Wrap-up (~15 seconds)

**SAY:**
> `/document` has already run by this point - it chained from `/review` and updated the README and docs to match what was built. So a debate here is a second opinion on a finished cycle, and you'd run `/peer-review` to evaluate its findings and feed the real ones back through the same loop.
>
> That's the full loop: explore, plan, build, review, document - all of it chaining after I approve the plan. The debate is the optional extra I reach for deliberately. Two phrases give me the wheel back at any point: "no chaining" and "report only".

---

## Quick Reference

| Step | Command | Time |
|------|---------|------|
| Explore the problem | `/explore` | ~60s |
| Create a plan | *chains automatically* | ~45s |
| Build it | `/execute` | ~60s |
| Review the code | *chains automatically* | ~45s |
| AI debate | `/ask-gpt` | ~45s |
| Documentation | *chains automatically* | ~15s |
| Wrap-up (narrate) | `/peer-review` | ~15s |

---

## Before the Demo

Checklist:
- [ ] Claude Code is installed and running
- [ ] API keys are configured (`.env.local` has OpenAI key for `/ask-gpt`)
- [ ] Decide up front whether the demo session can publish (Claude Code with artifacts on); if not, have the default browser ready, since the HTML views open there instead
- [ ] Clean git state (no uncommitted changes)
- [ ] You're in the project directory
- [ ] Terminal font is large enough for the audience to read
- [ ] No sensitive data visible in the terminal
- [ ] Do a full dry run at least once before the real demo
