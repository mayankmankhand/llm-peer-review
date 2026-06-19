---
name: security-audit
description: Deep, on-demand whole-repo security audit - entry points, authorization on every route, crypto inventory, and a recommended secret scan across git history. Use deliberately for a feature milestone, a pre-release gate, or when /review nudges you after a change to auth, crypto, secrets, or a new external entry point. For a fast per-change pass use /review-security; for dependency CVEs use /review-deps.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Security Audit

A deliberate, whole-repository security pass. Slower than `/review-security` and run on purpose, not on every change.

**Use this when:** You want a deep security look at the whole codebase, not just the latest diff - a feature milestone, a pre-release gate, or when `/review`/`/review-security` nudged you because a change touched auth, crypto, secrets, or a new external entry point.
**Don't use this when:** You just want a fast pass on a code change (use `/review-security`), or you are checking dependency versions/CVEs (use `/review-deps`).

**The difference from `/review-security`:** that skill reads one change through an attacker's eyes; this skill reads the **whole system** through an attacker's eyes - the surfaces a single diff can never show you (every route's authorization, secrets sitting in history, the crypto used app-wide).

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon
4. **Recommend tools, do not invent their output** - where a deterministic scanner is the right tool (secret history, dependency CVEs), recommend running it; never fabricate its results

</rules>

## Scope and Budget

This is a whole-repo audit, so the diff-scoped reading budget does not apply - but stay bounded or the audit never finishes:

- Start from the **entry points** (routes, handlers, CLI commands, webhooks, message consumers, public functions) and follow the **security-sensitive** paths from there. Do not read every file in the repo.
- Prioritize files that handle input, auth, secrets, crypto, file paths, queries, and external calls. Skip vendored code, generated files, and tests except where they reveal a real gap.
- Stop auditing a path once the risk is judgeable. Depth on the dangerous surfaces beats breadth across the harmless ones.
- When run directly on a large codebase, you may dispatch focused sub-agents in parallel (e.g. one per area: input/injection, auth/access-control, secrets/crypto, external calls/SSRF), then combine and renumber their findings into one sequence.

## How to Audit

<procedure>

### 1. Map the attack surface (entry points)

Enumerate where untrusted input enters the system: HTTP routes/endpoints, GraphQL resolvers, CLI commands, webhooks, file uploads, queue/message consumers, and any public API. This map is the spine of the audit - every later check hangs off it.

### 2. Authorization on every route

For each entry point that touches user-owned or privileged data, check: is there an authentication check, and an **authorization** check (does this caller own / have rights to this specific object)? The classic gap is an object fetched by id from the request with no ownership test (IDOR). Missing authorization is the most common serious flaw an audit catches that a diff review misses.

### 3. Secrets - in code and in history

Grep the working tree for hardcoded secrets (API keys, passwords, private-key headers, tokens, connection strings, provider patterns like `AKIA`, `ghp_`, `sk-`). Then **recommend a git-history scan**: a secret committed and later removed still lives in history and is still compromised. Recommend `gitleaks detect` (and `gitleaks detect --log-opts=--all` for full history) rather than trying to read history yourself - a scanner is exhaustive where you are not.

### 4. Crypto inventory

Inventory cryptographic use across the repo: hashing (flag MD5/SHA1 for security, fast hashing for passwords instead of Argon2id/bcrypt/scrypt), ciphers (flag DES/ECB), randomness (flag `Math.random()`/`rand()` for tokens or keys), and any hardcoded keys/IVs or disabled TLS verification.

### 5. The diff-catchable classes, repo-wide

Across the sensitive paths, apply the same vulnerability-class hunt `/review-security` runs (injection, XSS, path traversal, unsafe deserialization, SSRF, weak crypto), but now with whole-repo context - cross-file taint, shared helpers, and patterns repeated in many places.

### 6. What you do NOT own

- **Dependency CVEs and versions** go to `/review-deps` - it runs `npm audit` with real CVE data. Do not guess CVE numbers or affected ranges; if a dependency looks risky, say "run `/review-deps`."
- **Runtime/config/deployment** posture (TLS termination, headers, infra hardening) is often not visible in code. When a risk class cannot be confirmed from the repo, say so explicitly rather than giving false assurance.

### 7. Lead with the headline

Because an audit can surface many findings, structure the report so the reader gets the verdict and the worst risks first (see Output Format): the **Overall Verdict** line, then a ranked **Top issues** list, then the full findings. Every finding still carries a concrete source-to-sink exploit scenario in its `Example` field (the receipt rule applies - prove reachability, do not pattern-match).

</procedure>

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Noise Control

!`cat .claude/skills/shared/do-not-report.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

For audit findings, use the standard 4 fields with the `Example` field carrying the source-to-sink exploit scenario. The Overall Verdict and the readability backstop (lead with the top findings when there are many) matter most here, because an audit naturally produces a longer list than a single-change review.

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name security-audit` to the helper and omit the `chips` array (single-specialist context).

### Security Architect Check

<guidelines>

After the standard audit, step back and evaluate as a staff security architect:
- **Whole-system view?** - Across all entry points, is there a consistent authentication and authorization story, or are there gaps?
- **Secrets and crypto posture?** - Anything hardcoded, anything weak, anything that needs a history scan or a real secret manager?
- **What can this audit NOT see?** - Which risks live in runtime, config, or dependencies, and did I route them (CVEs -> `/review-deps`) or flag them as needing another tool rather than passing silently?
- **Biggest single risk?** - If the team fixes one thing this week, what is it?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
