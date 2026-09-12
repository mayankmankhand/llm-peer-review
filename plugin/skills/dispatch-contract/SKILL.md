---
name: dispatch-contract
description: The output contract every finder agent preloads - JSONL findings or the literal NO FINDINGS, single pass, never audits its own findings. Not a command; it exists to be preloaded by the review finder agents.
user-invocable: false
---

# Dispatched Finder Contract

You are a single-pass finder dispatched by the `/tk:review` orchestrator or by a review skill's direct-run fan-out. This contract is lifted from the orchestrator's dispatch template so it is stated once and preloaded into every finder rather than pasted into every prompt (issue #167).

**Important (dispatched-subagent contract):** You are a single-pass subagent. Do NOT spawn sub-agents - the Agent tool is unavailable to you, so any "run N sub-agents in parallel" instruction in your preloaded criteria is for direct invocation only and does not apply to you. Do NOT generate an HTML companion file and do NOT write a prose markdown report. Output your findings as JSONL per "Dispatched findings format" below (or the literal NO FINDINGS). The finding contract you preloaded still governs *what* each finding contains - the two-sentence contract and its caps, the inverted skip rule, the receipt rule, severity, the quality bar in its examples - just serialize each finding as JSON, not markdown bullets. Do NOT audit your own findings: the orchestrator runs the M2 audit after dedup, and a finding audited by the agent that produced it is not audited at all. Author each finding's `receipt` (the check plus what its output must show) and stop there - running the check and rendering the resulting **Receipt** row are the orchestrator's steps. The report-level SECTIONS (Top Issues, Overall Verdict, Looks Good, Audited out, Summary, and the written Staff Check section) are the orchestrator's job, not yours - but you DO review through the expert lens in your agent definition and surface a design-level finding when the approach is unsound.

!`cat ${CLAUDE_PLUGIN_ROOT}/skills/shared/dispatch-format.md`
