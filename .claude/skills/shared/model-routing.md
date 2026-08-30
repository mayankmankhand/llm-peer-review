# Model Routing (subagent pins)

Shared reference for every command that spawns a subagent. Decided in issue #152, building on the #123 toolkit audit ("pin down, inherit up") and live run transcripts. Call sites quote this rule or point here; they never restate it.

## The rule

**Pin down, inherit up, never pin the judges or the code-writers.**

- **Finders pin one tier down.** A finder reads material and reports findings that a stronger judge audits afterward. The review specialists and the index chunk mappers are finders; they run on the pinned agents in the roster below.
- **Judges and synthesis inherit.** The M2 skeptics and voters, the M3 verifier, and all main-loop orchestration run on the session model. A judge never runs below the tier of the work it judges: a weaker judge cannot reliably recognize quality above its own ceiling. The strong audit is exactly what makes cheap finders safe - a weak finding from a pinned finder dies in the session-model audit before the user sees it.
- **Code-writers never pin.** `/execute` implementation agents edit real files; they stay on the session model.
- **The main loop never pins.** Every model keeps its own prompt cache, so a main-loop model switch forces an uncached re-read of the whole conversation, twice (switch and revert). Subagents build their context from scratch, so pinning them costs nothing.

## The roster

The pin lives in agent frontmatter under `.claude/agents/`, never in prose. A prompt's user-facing message is not enforcement (the #131 lesson); frontmatter is applied by the harness on every dispatch.

| Agent | Model | Effort | Used by |
|---|---|---|---|
| `review-finder` | sonnet | high | `/review` Phase 2 dispatch; the direct-run fan-outs inside the review skills |
| `index-mapper` | haiku | low | `/index` Step 3 chunk analysis |

Why these tiers: reviewer workers one tier down is the documented consensus (Anthropic's own example agent is a code reviewer on sonnet at high effort, and its research system ran a frontier lead over sonnet workers), and mechanical read-and-extract behind a strict output contract is the established bottom-tier sweet spot.

Everything else inherits: the M2 and M3 audit and verify agents, `/execute` implementers, `/security-audit` area agents, ad hoc research subagents, and every main-loop stage. When dispatching an inherit role, omit the model parameter entirely rather than pinning a top-tier ID - a hardcoded top-tier pin goes stale across model generations and can be blocked by an org policy.

Models are named by alias (`sonnet`, `haiku`), never by dated model IDs, so the roster tracks each current generation without edits.

## Guardrails

1. **Structured output contracts.** Every pinned worker returns a checkable format (JSONL findings, fixed module blocks), so weak or malformed output is visible rather than silent.
2. **One-tier-up re-spawn.** When a pinned worker's output is weak or malformed, re-dispatch that one worker one tier up, once. Bounded worst case: one extra spawn.
3. **A/B receipt before a new pin ships.** Any new pin is validated once: the same diff reviewed twice in report-only mode (pinned and inherited, same session model both runs), post-audit survivors compared. The pin ships only when the pinned run misses nothing real.
4. **Rollback is one line.** Delete the `model:` line from the agent file (or dispatch `general-purpose` with no model parameter); everything reverts to inherit.

## Fallback

If a named agent type from the roster is unavailable (an older install that predates `.claude/agents/`), dispatch `subagent_type=general-purpose` with no model parameter. Inheriting is always safe; a silent wrong pin is not.
