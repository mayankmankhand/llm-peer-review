You are running as Cursor's agent, in the editor or the `agent` CLI. The toolkit's rules are unchanged; this is what differs about the harness.

**Subagents.** They live in `.cursor/agents/` and are dispatched by name: write `/name` followed by the task in the prompt you send. Each starts with a clean context and sees only what your dispatch prompt pastes, which is exactly what the M2 skeptics and the design critic need. Do not rely on a subagent inheriting `.cursor/rules` text; paste what it must know.

**readonly blocks shell as well as edits.** Cursor's `readonly: true` denies file edits, deletes, MCP, and every shell command, so the Dependency Security and Browser QA lenses, which must run `npm audit`, `gh api`, and `node .claude/scripts/browse.js`, dispatch `/review-finder-shell` instead of `/review-finder`. Every finder runs inside the write-guard: run `node .claude/scripts/write-guard.js begin <label>` before the dispatch and `node .claude/scripts/write-guard.js end <label>` after it. An `INVALID` result means the finder changed the working tree and was reverted; redispatch it once, then treat its findings as unaudited.

**The M2 canary.** Before each audit dispatch, mint a random token and keep it in your own context only; never paste it into a skeptic's prompt. Each skeptic's first output line must say whether it can see any such token. A skeptic that sees one had your context: redispatch it once, and if it sees the token again, mark its findings unaudited under M2's existing rule. Save the token and each answer with the run's receipts.

**Skill names.** Cursor ships built-in skills called `review` and `review-security`, so the toolkit's `/review` and `/review-security` are typed here as `/tk-review` and `/tk-review-security`. Every other skill keeps its name. The skill menu also lists the raw `.claude/skills/` copies and `project-context`: the same skills with their injection tokens unexpanded. Prefer the `.agents/skills/` copy or the `tk-` alias; when a body you are following contains a line that begins with the injection token, read the path it names before continuing.

**Unattended runs need Allowlist mode.** The loop runs without approval prompts only in Allowlist run mode, after setup has merged the toolkit's `terminalAllowlist` into the per-machine Cursor permissions file. That file is machine-global, so every Cursor project on the machine is affected. In any other mode each command waits for approval and the loop stalls; say so rather than working around it.

**Worktrees.** Cursor's native worktrees can replace the create half of `/worktree`. Raise `cursor.worktreeMaxCount` above its default of 25 first, or Cursor deletes worktrees the toolkit created once the count is exceeded.

**Viewport.** This session cannot publish to a hosted page. Render every artifact without `--no-abs` and open it with `bash .claude/scripts/open-artifact.sh <file>`. That is the complete flow here.

**Chaining (M14).** The handoff is carried by prose: when a stage finishes, name the next stage explicitly and start it. The `stop` hook in `.cursor/hooks.json` reads the chain-state file as a backstop and resubmits the next stage once if the prose handoff did not happen. "No chaining" still stops after the current stage.
