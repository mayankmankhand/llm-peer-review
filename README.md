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
| `/dev-lead-gpt` | AI peer review with ChatGPT debate (3 rounds) |
| `/dev-lead-gemini` | AI peer review with Gemini debate (3 rounds) |
| `/package-review` | Review a package/codebase |
| `/learning-opportunity` | Pause to learn a concept at 3 levels of depth |

## Getting Started

1. **Copy the commands folder** to your project:
   ```
   .claude/commands/
   ```

2. **Copy CLAUDE.md** to your project root (customize as needed)

3. **For `/dev-lead-gpt` or `/dev-lead-gemini`** (optional - requires API keys and Node.js 16+):
   ```bash
   npm install
   cp .env.local.example .env.local
   # Add your OPENAI_API_KEY for /dev-lead-gpt
   # Add your GEMINI_API_KEY for /dev-lead-gemini
   ```

4. **Use in Cursor** - Type `/` followed by the command name

## How Dev Lead Commands Work

The `/dev-lead-gpt` and `/dev-lead-gemini` commands automate AI peer review by having Claude debate with another AI (ChatGPT or Gemini) about your code or plan. Instead of manually copying code to another AI, these commands orchestrate everything automatically.

### Example Session

```
You: /dev-lead-gpt

Claude: What would you like me to review?
        1. Plan    2. Code    3. Branch    4. Feature    5. Other

You: Review the auth middleware

Claude: [Gathers context, sends to ChatGPT]
        [ChatGPT reviews, finds issues]
        [Claude responds, they debate for 3 rounds]
        
        --- Summary ---
        Agreed: Add token expiry check, extract magic numbers
        
        Recommended Actions:
        - [ ] Add token expiry validation
        - [ ] Move 3600 to TOKEN_EXPIRY_SECONDS
        
        Want me to implement these?

You: Yes

Claude: [Makes the changes]
```

Not satisfied? Run it again for another round of review. Try `/dev-lead-gemini` for a different perspective.

## Project Structure

```
.claude/commands/    # The slash command definitions
scripts/             # Node.js scripts for dev-lead commands
CLAUDE.md            # AI assistant instructions (portable)
README.md            # This file
```

## Customization

- **CLAUDE.md** contains your workflow preferences and rules - edit to match your style
- **Each command** in `.claude/commands/` can be customized independently
- **Git workflow guidance** in CLAUDE.md can be adjusted for your team's practices

## License

MIT — see [LICENSE](LICENSE)
