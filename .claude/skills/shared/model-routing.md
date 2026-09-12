# Model Routing (subagent pins)

Shared reference for every command that spawns a subagent. Decided in issue #152, building on the #123 toolkit audit ("pin down, inherit up") and live run transcripts. Call sites quote this rule or point here; they never restate it.

## The rule

**Pin down, inherit up, never pin the judges or the code-writers.**

- **Finders may pin one tier down, once a receipt says they can.** A finder reads material and reports findings that a stronger judge audits afterward, which is what makes a cheaper finder thinkable at all. It is a candidate, not an entitlement: guardrail 3 decides, and it has already revoked one. The review specialists and the index chunk mappers are the finders; the roster below records where each one actually landed.
- **Judges and synthesis inherit.** The M2 skeptics and voters, the M3 verifier, and all main-loop orchestration run on the session model. A judge never runs below the tier of the work it judges: a weaker judge cannot reliably recognize quality above its own ceiling. The strong audit is exactly what makes cheap finders safe - a weak finding from a pinned finder dies in the session-model audit before the user sees it.
- **Code-writers never pin.** `/execute` implementation agents edit real files; they stay on the session model.
- **The main loop never pins.** Every model keeps its own prompt cache, so a main-loop model switch forces an uncached re-read of the whole conversation, twice (switch and revert). Subagents build their context from scratch, so pinning them costs nothing.

## The roster

The pin lives in agent frontmatter under `.claude/agents/`, never in prose. A prompt's user-facing message is not enforcement (the #131 lesson); frontmatter is applied by the harness on every dispatch. Call sites dispatch by the literal `subagent_type=` value written in the command; under the plugin those values carry the plugin prefix, which the generator writes, so the names in this table are the unprefixed source names.

| Agent | Model | Effort | Tools | Used by |
|---|---|---|---|---|
| `review-code-finder`, `review-ux-finder`, `review-copy-finder`, `review-security-finder`, `review-plan-finder`, `review-commands-finder` | inherit | high | Read, Grep, Glob | `/review` Phase 2 dispatch; the direct-run fan-out of the matching `/review-<kind>` skill; `/review-full` fans out to the code, plan, ux, and security finders (issue #167) |
| `review-browser-finder`, `review-deps-finder` | inherit | high | Read, Grep, Glob, Bash | The same, with Bash because Browser QA drives `browse.js` and Dependency Security runs `npm audit`, `npm outdated`, `gh api` |
| `audit-skeptic` | inherit | high | Read, Grep, Glob, Bash (read-only use) | M2 tier 2 shards and tier 3 voters, every runner (#167) |
| `fix-verifier` | inherit | high | Read, Grep, Glob, Bash (read-only use) | M3 judgment re-verification, every runner (#167) |
| `plan-critic` | inherit | high | Read | `/create-plan` critic loop before the approval stop (#167) |
| `design-critic` | inherit | high | Read | `/execute` design steps (M15, issue #160) |
| `index-mapper` | sonnet | low | Read, Grep, Glob | `/index` Step 3 chunk analysis |
| `correction-extractor` | inherit | low | Read | `/document` capture stage (issue #157) |
| `review-finder` (deprecated in 7.0, removed in 8.0) | inherit | high | Read, Grep, Glob, Bash | Downstream commands that still dispatch the generic finder by name; the toolkit itself no longer does |

Why these tiers: `index-mapper` runs the tier issue #131 chose for chunk analysis and has run live since, moved here from prose into frontmatter so the cost message is enforced rather than aspirational; low effort matches mechanical read-and-extract behind a strict output contract. The eight per-kind finders inherit because a Sonnet pin was tested on this exact job, on their predecessor `review-finder`, and failed its receipt - see "Tested and revoked" below; the per-kind split changed what they preload (each finder's `skills:` line loads its `review-<kind>-criteria` skill and the `dispatch-contract` skill, so nothing is pasted per dispatch), not the job, so the revocation carries over and a new pin needs a new A/B. `correction-extractor` inherits for the same reason: no A/B receipt has been run for it yet, and guardrail 3 decides. It is a strong pin candidate (mechanical read-and-extract behind a strict output contract, the same shape as `index-mapper`) and it has an unusually strong downstream judge, since the human accepts or rewrites every open code before a row is written. None of that substitutes for the receipt. Low effort matches the job shape. `audit-skeptic`, `fix-verifier`, `plan-critic`, and `design-critic` inherit by rule rather than by missing receipt: a judge whose verdict is final never runs below the tier of the work it judges. High effort matches a judgment call made from bytes it did not produce.

Every agent in the roster declares a `tools` list granting no Edit, Write, or NotebookEdit: a finder that could edit would apply changes before the M2 audit judged them, bypassing the loop, and a judge that could edit would be a fixer. Bash appears only where the job runs tooling (the browser and dependency finders) or re-runs a receipt's read-only check (the skeptic and the verifier). `index-mapper`, which only reads its chunk, has none; neither does `correction-extractor`, which reads only the pre-filtered candidate list handed to it, nor `design-critic` and `plan-critic`, which read one artifact each and nothing else (no Bash, so they cannot go looking for the code they are judging).

Everything else inherits: `/execute` implementers, `/security-audit` area agents, ad hoc research subagents, and every main-loop stage. When dispatching an inherit role, omit the model parameter entirely rather than pinning a top-tier ID - a hardcoded top-tier pin goes stale across model generations and can be blocked by an org policy.

Models are named by alias (`sonnet`, `haiku`), never by dated model IDs, so the roster tracks each current generation without edits.

## Guardrails

1. **Structured output contracts.** Every worker in the roster returns a checkable format (JSONL findings, fixed module blocks), so weak or malformed output is visible rather than silent. This holds whether or not the worker is pinned: a malformed return is the cheapest signal either way, and the A/B that revoked the review pin caught one.
2. **Bounded re-dispatch.** When a roster worker's output is weak or malformed, re-dispatch that one worker once - one tier up when it was pinned, same tier when it inherits (there is nothing above the session model to escalate to). Bounded worst case: one extra spawn.
3. **A/B receipt before a new pin ships.** Any new pin is validated once: the same diff reviewed twice in report-only mode (pinned and inherited, same session model both runs), post-audit survivors compared. The pin ships only when the pinned run misses nothing real.
4. **Rollback is one line.** Delete the `model:` line from the agent file (or dispatch `general-purpose` with no model parameter); everything reverts to inherit.

## Fallback

If a named agent type from the roster is unavailable, first check registration: an agent added by a plugin install or update, or a file written to `.claude/agents/` mid-session, is not dispatchable until the session reloads it (verified 2026-09-12: two probes ninety seconds apart could not find a freshly written agent file; a fresh process saw it at once). Run `/reload-plugins` once and retry. Still unavailable (an older copy-install that predates `.claude/agents/`, or a downstream project running the toolkit from before the agent existed): dispatch `subagent_type=general-purpose` carrying exactly what that agent's row declares - its model when the row names one, no model parameter at all when the row reads inherit - plus whatever the agent would have preloaded, pasted into the prompt: a finder's `review-<kind>-criteria` and `dispatch-contract` skills (paste the fragments each one includes, listed in the orchestrator's Phase 2, never the SKILL.md file itself: an include line does not expand when pasted), a skeptic's or verifier's M2 or M3 instruction, a critic's fixed prompt. Mirroring the roster is what keeps behavior identical on old and new installs. Inventing a different tier at the call site is the #131 bug in a new costume - the roster, not the call site, decides.

## Tested and revoked

Pins that were measured and dropped. A revoked pin stays listed so nobody re-proposes it from memory.

- **`review-finder` on sonnet (tested 2026-08-29, revoked; the verdict carries over to the eight per-kind finders that replaced it in v7.0.0, since the job is unchanged).** The same 16-file diff was reviewed twice in report-only mode by five specialists each, identical prompts, session model Fable 5 for both arms. Pinned: 450s wall clock, 6 findings. Inherited: 530s, 13 findings. After tier-1 receipts and a sharded tier-2 audit, 4 findings survived: each arm found one the other missed, but the one the pinned arm missed was a real bug in shipped installer code (`failglob` overriding `nullglob`, aborting setup on an empty directory), confirmed by an executed receipt. One pinned worker also broke the JSONL output contract, the failure mode guardrail 1 exists to catch. Guardrail 3's bar is "misses nothing real", so the pin was revoked; 15% wall clock was never going to pay for it. Re-test before proposing it again, and note that a single A/B is a smoke test, not statistics.
