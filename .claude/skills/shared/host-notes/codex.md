You are running inside OpenAI Codex CLI or the Codex IDE extension. Everything under `.agents/` and `.codex/` is generated from `.claude/` by `node .claude/scripts/build-layouts.js`; never edit those files or let an auto-fix touch them. Change the source and rebuild.

**Invoking skills.** Every toolkit command is a skill here, invoked as `$name` (`$explore`, `$review`). There is no slash form and no programmatic Skill tool, so a handoff is written in prose: name the next stage ("Now invoke `$create-plan`"). `$ask-gpt`, `$ask-gemini`, and `$peer-review` are typed by a human only; their `agents/openai.yaml` turns implicit invocation off, and you never invoke them yourself (M14).

**Subagents.** The four toolkit roles are the agents in `.codex/agents/` (`review-finder`, `index-mapper`, `design-critic`, `correction-extractor`). Dispatch one by naming it when you spawn an agent, and always set `fork_turns` to `none`: an omitted value forks your whole conversation, and a skeptic that inherits the parent's history is not a fresh judge. The M2 canary proves it. Before each audit dispatch, mint a random token and keep it in your own context only. Each skeptic's first output line states whether it can see any such token. Save the token and every answer under `reports/receipts/<run-stamp>/`. A skeptic that can see the token is redispatched once; if it still can, its lens is marked unaudited. The role's `sandbox_mode = "read-only"` is not enforced under a writing parent, so it is never the guarantee.

**Finders and the write-guard.** Run every finder between `node .claude/scripts/write-guard.js begin <label>` and `node .claude/scripts/write-guard.js end <label>`. The `end` call reverts anything the finder changed and prints `INVALID` when it had to. On `INVALID`, redispatch that finder once, then mark its lens unaudited.

**Code and security review.** `codex review --uncommitted` is the code and security finder here. It is a nested Codex that needs network, so `.codex/rules/toolkit.rules` allow-lists it to run outside the sandbox. Run it from the shell (you cannot type `/review`), collect its findings, and pass them through the same dedup and M2 audit as every other lens. Nothing it reports is applied before the audit passes.

**Plan mode.** Enter plan mode for `$explore` and `$create-plan`, so no-edits is enforced by the tool, not by prose. Leave it before `$execute`.

**Artifacts.** This session cannot publish to a hosted page. Render every artifact with `node .claude/scripts/render-html.js` without `--no-abs`, then open it with `bash .claude/scripts/open-artifact.sh <file>`. That is the complete flow, not a degraded one.

**Chaining.** Repo hooks in `.codex/hooks.json` run only after the user has trusted them once via `/hooks`, and never in the IDE extension. So the M14 handoff is carried by prose: when a stage finishes, name the next stage explicitly. The Stop hook, once trusted, reads the chain-state file and continues the session; treat it as a backstop, not the working path.

**Permissions.** `.codex/rules/toolkit.rules` is the sandbox escape hatch: each toolkit command prefix runs outside the sandbox without a prompt. If a loop command still prompts, the documented wider fallback is `network_access = true` under `[sandbox_workspace_write]` in `.codex/config.toml`.
