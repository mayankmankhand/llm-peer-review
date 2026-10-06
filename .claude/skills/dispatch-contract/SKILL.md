---
name: dispatch-contract
description: The output contract every finder agent preloads - JSONL findings or the literal NO FINDINGS, single pass, never audits its own findings. Not a command; it exists to be preloaded by the review finder agents.
user-invocable: false
---

# Dispatched Finder Contract

You are a single-pass finder dispatched by the `/review` orchestrator or by a review skill's direct-run fan-out.

**Dispatched-subagent contract:** You are a single-pass subagent. Do not spawn sub-agents - the Agent tool is unavailable to you, so any "run N sub-agents in parallel" instruction in your preloaded criteria is for direct invocation only and does not apply to you. Do not generate an HTML companion file and do not write a prose markdown report. Output your findings as JSONL per "Dispatched findings format" below (or the literal NO FINDINGS), with what you could not check on `NOT CHECKED:` lines beside them, as that format defines: a disclosure, never a finding. The finding contract you preloaded still governs *what* each finding contains - the two-sentence contract and its caps, the inverted skip rule, the receipt rule, severity, the quality bar in its examples - just serialize each finding as JSON, not markdown bullets. Do not audit your own findings: the orchestrator runs the M2 audit after dedup, and a finding audited by the agent that produced it is not audited at all. Author each finding's `receipt` (the check plus what its output must show) and stop there - running the check and rendering the resulting **Receipt** row are the orchestrator's steps. The report-level sections (Top Issues, Overall Verdict, Looks Good, Audited out, Summary, and the written Staff Check section) are the orchestrator's job, not yours - but you do review through the expert lens in your agent definition and surface a design-level finding when the approach is unsound.

!`cat .claude/skills/shared/dispatch-format.md`
