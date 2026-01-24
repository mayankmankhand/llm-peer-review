# Cursor Slash Command Toolkit

A portable set of Cursor slash commands for "PM learning to code" workflows.

## Commands

| Command | Purpose |
|---------|---------|
| `/explore` | Understand the problem, ask clarifying questions before implementation |
| `/create-plan` | Create a step-by-step implementation plan with status tracking |
| `/execute` | Build the feature, updating the plan as you go |
| `/review` | Review code - report issues only, don't fix until approved |
| `/peer-review` | Evaluate feedback from other AI models |
| `/document` | Update documentation after changes |
| `/create-issue` | Create GitHub issues (asks questions first, keeps them short) |
| `/dev-lead-1` | AI peer review with ChatGPT debate (3 rounds) |
| `/package-review` | Review a package/codebase |
| `/learning-opportunity` | Pause to learn a concept at 3 levels of depth |

## Getting Started

1. **Copy the commands folder** to your project:
   ```
   .claude/commands/
   ```

2. **Copy CLAUDE.md** to your project root (customize as needed)

3. **For `/dev-lead-1`** (optional - requires OpenAI API and Node.js 16+):
   ```bash
   npm install
   cp .env.local.example .env.local
   # Add your OPENAI_API_KEY to .env.local
   ```

4. **Use in Cursor** - Type `/` followed by the command name

## How `/dev-lead-1` Works

The `/dev-lead-1` command automates AI peer review by having Claude and ChatGPT debate your code or plan. Instead of manually copying code to ChatGPT, this command orchestrates everything automatically.

> **Privacy Note:** This command sends your code/diffs to OpenAI's API for review. To use it safely:
> - Don't include secrets, API keys, or `.env` files in the review scope
> - Prefer reviewing `git diff` or specific files over entire directories
> - Avoid including lockfiles or large generated files
> - Review what's being sent before confirming

### What Happens When You Run It (v1.0)

1. **Claude asks what to review** - You choose: a plan file, specific code, a branch, or a feature
2. **Claude gathers context** - Reads the files or runs `git diff` to collect what needs review
3. **ChatGPT reviews** - The script calls OpenAI's API and ChatGPT provides initial feedback
4. **3 rounds of debate** - Claude responds to ChatGPT's feedback, ChatGPT responds back (currently fixed at 3 rounds)
5. **Summary generated** - Final summary shows agreed points, disagreements, and recommended actions
6. **You decide** - Claude asks if you want to implement the recommendations

### Example Session

```
You: /dev-lead-1

Claude: What would you like me to review?
        1. Plan - A PLAN*.md file or implementation approach
        2. Code - Specific files or recent changes
        3. Branch - All changes on current branch vs main
        4. Feature - A complete feature across multiple files
        5. Other - Describe what you want reviewed

You: 2. Code - review the auth middleware I just wrote

Claude: I'll review src/middleware/auth.ts. Let me gather the context
        and get ChatGPT's review...

        (Under the hood, Claude runs: node scripts/dev-lead.js review ...)
        (You don't need to run this manually—Claude handles it for you)

        --- ChatGPT Review ---
        ## Summary
        The auth middleware has good structure but has a potential 
        security issue with token validation...

        ## Issues Found
        - **[CRITICAL]** Token not validated against expiry
        - **[MAJOR]** Missing rate limiting
        - **[MINOR]** Consider extracting magic numbers

        ## Strengths
        - Clean separation of concerns
        - Good error messages
        ---

        As the author, here's my response to ChatGPT:

        ## Accepted
        - Token expiry check - valid point, I'll add this

        ## Discussing
        - Rate limiting - this is handled at the API gateway level...

        [Continues for 3 rounds...]

        --- Final Summary ---
        ## Agreed Points
        - Add token expiry validation
        - Extract magic numbers to constants

        ## Recommended Actions
        - [ ] [CRITICAL] Add token expiry check
        - [ ] [MINOR] Move 3600 to TOKEN_EXPIRY_SECONDS constant

        Would you like me to implement these recommendations?

You: Yes

Claude: [Implements the changes if you approve]
```

### Running Multiple Review Cycles

You can run `/dev-lead-1` multiple times on the same code. Each run is independent - useful when:
- You've made changes based on previous feedback and want fresh review
- You want to review different aspects (first run: security, second run: performance)
- You want more perspectives on a complex decision

## Project Structure

```
.claude/commands/    # The slash command definitions
scripts/             # Node.js scripts for /dev-lead-1
CLAUDE.md            # AI assistant instructions (portable)
README.md            # This file
```

## Customization

- **CLAUDE.md** contains your workflow preferences and rules - edit to match your style
- **Each command** in `.claude/commands/` can be customized independently
- **Git workflow guidance** in CLAUDE.md can be adjusted for your team's practices

## License

MIT — see [LICENSE](LICENSE)
