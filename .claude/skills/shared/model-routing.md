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
| `review-finder` | inherit | high | `/review` Phase 2 dispatch; the direct-run fan-outs inside the review skills |
| `index-mapper` | sonnet | low | `/index` Step 3 chunk analysis |

Why these tiers: `index-mapper` runs the tier issue #131 chose for chunk analysis and has run live since, moved here from prose into frontmatter so the cost message is enforced rather than aspirational; low effort matches mechanical read-and-extract behind a strict output contract. `review-finder` inherits because a Sonnet pin was tested on this exact job and failed its receipt - see "Tested and revoked" below. Both agents declare a read-only `tools` list: a finder that could write would apply changes before the M2 audit judged them, bypassing the loop.

Everything else inherits: the M2 and M3 audit and verify agents, `/execute` implementers, `/security-audit` area agents, ad hoc research subagents, and every main-loop stage. When dispatching an inherit role, omit the model parameter entirely rather than pinning a top-tier ID - a hardcoded top-tier pin goes stale across model generations and can be blocked by an org policy.

Models are named by alias (`sonnet`, `haiku`), never by dated model IDs, so the roster tracks each current generation without edits.

## Guardrails

1. **Structured output contracts.** Every pinned worker returns a checkable format (JSONL findings, fixed module blocks), so weak or malformed output is visible rather than silent.
2. **One-tier-up re-spawn.** When a pinned worker's output is weak or malformed, re-dispatch that one worker one tier up, once. Bounded worst case: one extra spawn.
3. **A/B receipt before a new pin ships.** Any new pin is validated once: the same diff reviewed twice in report-only mode (pinned and inherited, same session model both runs), post-audit survivors compared. The pin ships only when the pinned run misses nothing real.
4. **Rollback is one line.** Delete the `model:` line from the agent file (or dispatch `general-purpose` with no model parameter); everything reverts to inherit.

## Fallback

If a named agent type from the roster is unavailable (an older install that predates `.claude/agents/`), dispatch `subagent_type=general-purpose` carrying exactly what that agent's row declares: its model when the row names one, and no model parameter at all when the row reads inherit. Mirroring the roster is what keeps behavior identical on old and new installs. Inventing a different tier at the call site is the #131 bug in a new costume - the roster, not the call site, decides.

## Tested and revoked

Pins that were measured and dropped. A revoked pin stays listed so nobody re-proposes it from memory.

- **`review-finder` on sonnet (tested 2026-08-29, revoked).** The same 16-file diff was reviewed twice in report-only mode by five specialists each, identical prompts, session model Fable 5 for both arms. Pinned: 450s wall clock, 6 findings. Inherited: 530s, 13 findings. After tier-1 receipts and a sharded tier-2 audit, 4 findings survived: each arm found one the other missed, but the one the pinned arm missed was a real bug in shipped installer code (`failglob` overriding `nullglob`, aborting setup on an empty directory), confirmed by an executed receipt. One pinned worker also broke the JSONL output contract, the failure mode guardrail 1 exists to catch. Guardrail 3's bar is "misses nothing real", so the pin was revoked; 15% wall clock was never going to pay for it. Re-test before proposing it again, and note that a single A/B is a smoke test, not statistics.
