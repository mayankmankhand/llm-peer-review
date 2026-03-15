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
> Every feature starts with `/explore`. It asks you questions before you write any code - like a PM would.

**TYPE:**
```
/explore Add a /hello slash command that greets the user by name
```

**WAIT** for Claude to ask scoping questions (2-4 questions).

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
> Now that Claude understands the feature, we create a plan. This produces a markdown file with tracked steps - so you always know where you are.

**TYPE:**
```
/create-plan
```

**WAIT** for the plan to be generated.

**SAY:**
> Notice the plan has status emojis, a progress percentage, and clear steps. This becomes your single source of truth for the feature. No more "where were we?" moments.

**TIP:** If the plan is long, just highlight the Tasks section and move on.

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
> Before we ship anything, we review. The toolkit has a critical rule: report first, fix later. The review command finds issues but never changes your code without permission.

**TYPE:**
```
/review-code
```

**WAIT** for the review report.

**SAY:**
> This is a written report - bugs, style issues, suggestions. Nothing gets changed until you say "fix it." That keeps you in control.

**TIP:** If the review is clean (no issues), say: "A clean review is great - but the point is that it always checks before changing anything."

---

## 6. AI Peer Review (~45 seconds)

**SAY:**
> Here's where it gets interesting. We send our work to ChatGPT for a 3-round debate with Claude. They push back on each other, concede points, and produce a structured verdict.

**TYPE:**
```
/ask-gpt
```

**WAIT** for the debate to run (this takes 30-60 seconds).

**SAY** (while waiting):
> This is running 3 rounds of back-and-forth. ChatGPT reviews the work first, then Claude responds as the author - accepting some points, pushing back on others. ChatGPT follows up, and they go back and forth for 3 rounds. At the end you get a summary of what they agreed on, where they disagreed, and a prioritized action list.

**TIP:** If the API is slow, keep narrating: "The models are debating right now - you'll see the rounds appear as they complete." If it errors, say: "In a real session you'd retry - the output is a structured verdict with agreed/disagreed/actions."

---

## 7. Wrap-up (~15 seconds)

**SAY:**
> After the debate, you'd run `/peer-review` to evaluate the findings and decide what to act on. Then `/document` updates your README and docs to match what was built.
>
> That's the full loop: explore, plan, build, review, debate, document. Every step has a command. You stay in control the whole time.

---

## Quick Reference

| Step | Command | Time |
|------|---------|------|
| Explore the problem | `/explore` | ~60s |
| Create a plan | `/create-plan` | ~45s |
| Build it | `/execute` | ~60s |
| Review the code | `/review-code` | ~45s |
| AI debate | `/ask-gpt` | ~45s |
| Wrap-up (narrate) | `/peer-review`, `/document` | ~15s |

---

## Before the Demo

Checklist:
- [ ] Claude Code is installed and running
- [ ] API keys are configured (`.env.local` has OpenAI key for `/ask-gpt`)
- [ ] Clean git state (no uncommitted changes)
- [ ] You're in the project directory
- [ ] Terminal font is large enough for the audience to read
- [ ] No sensitive data visible in the terminal
- [ ] Do a full dry run at least once before the real demo
