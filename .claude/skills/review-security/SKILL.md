---
name: review-security
description: Application security review of a code change - the diff-catchable vulnerability classes (secrets, injection, XSS, path traversal, SSRF, unsafe deserialization, weak crypto) reviewed through an adversarial lens. Use when code changed and you want a security pass; runs automatically inside /review on any code change. For dependency CVEs use /review-deps; for a deep whole-repo audit use /security-audit.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Agent
---

# Security Review

Be thorough but concise. Read the change like an attacker, not like an author.

**Use this when:** Reviewing a code change for application-level security flaws - the kind a diff can actually reveal. Runs automatically inside `/review` whenever code changes, and can be called directly as `/review-security`.
**Don't use this when:** Auditing dependency versions or CVEs (use `/review-deps`), doing a deep whole-repo security pass (use `/security-audit`), or reviewing non-security code quality (use `/review-code`).

**How it differs from `/review-code`:** same code, attacker's eyes. `/review-code` asks "is this written well?"; this skill asks "what can a malicious user make this do?" That adversarial lens surfaces a class of bug a correctness review walks straight past.

## Critical Rules

<rules>

1. **REPORT ONLY** - Do NOT make any changes or edits to files
2. **Wait for approval** - Only fix things after I say "fix it"
3. **Explain simply** - Use plain English, avoid jargon
4. **Stay silent when there is nothing to find** - a security reviewer that cries wolf gets muted. See the gate below.

</rules>

## How to Review

<procedure>

### 1. The danger-spot gate (check this first)

A security finding needs a danger spot in the change. Before reporting anything, ask: does this diff actually touch one of these?

- A **query or data store** built or run with outside input (SQL, NoSQL, ORM raw escape hatches)
- A **shell / process** call (`exec`, `system`, `subprocess`, backticks, `child_process`)
- A **file path** built from input (reads, writes, uploads, `sendFile`)
- An **HTML / template render** of data that could be attacker-controlled
- **Deserialization** of outside data (`pickle`, `yaml.load`, `unserialize`, `readObject`)
- **Auth / access-control / session** logic, or **secret / credential / crypto** handling
- A **server-side fetch** of a user-supplied URL (SSRF surface)

**If the change touches none of these, report nothing.** When `/review` dispatched you as a subagent, "report nothing" means emit the literal `NO FINDINGS` (the dispatch contract requires JSONL or that exact line - never a stray prose sentence). On a direct `/review-security` call, a one-line "no security-sensitive sink in this change" is fine. Do not manufacture a finding to look busy. Routine diffs (formatting, copy, pure refactors with no new sink) should leave this skill quiet.

### 2. Hunt the diff-catchable vulnerability classes

When a danger spot is present, look for these specific classes (the ones a code change actually reveals):

- **Hardcoded secrets** - API keys, passwords, private keys, tokens, connection strings committed in code or config
- **SQL / NoSQL injection** - input concatenated or interpolated into a query instead of parameterized
- **OS command injection** - input reaching a shell call
- **Code / template injection** - input reaching `eval`/`exec`/dynamic import, or a server-side template
- **Cross-site scripting (XSS)** - untrusted data into `innerHTML`, `dangerouslySetInnerHTML`, `| safe`, `document.write`
- **Path traversal** - input in a file path without canonicalize-and-contain (`../` escaping a base dir)
- **Unsafe deserialization** - untrusted data into an unsafe deserializer
- **SSRF** - server fetching a user-controlled URL with no allowlist / metadata-IP block
- **Weak crypto / randomness** - MD5/SHA1/DES/ECB, `Math.random()` for tokens, hardcoded keys/IVs, fast hashing for passwords
- **Disabled transport security** - `verify=False`, `rejectUnauthorized: false`, plaintext for sensitive data

Also flag, as a smell that needs context (not a hard claim): **missing authorization** (an object looked up by id with no ownership check), **broken authentication** (no rate-limit/lockout, non-constant-time compares), and **input that is never validated** before a sensitive use.

### 3. Reason source-to-sink, and require an exploit sentence

A real finding traces untrusted input from where it **enters** (the source) to where it **does damage** (the sink), with no safe transformation in between (parameterization, encoding, allowlist validation, canonicalization). A pattern match is not a finding.

**Every security finding's `Example` field IS its exploit scenario:** a concrete, one-line "an attacker could ..." that walks input from source to sink. If you cannot write that sentence - because the input is a hardcoded constant, an internal value, or already sanitized upstream - the finding is not real. Drop it. This is the single biggest false-positive killer, and it pairs with the receipt rule in the output template (point at the line; prove the path).

Recognize when something is already safe: a parameterized query, framework auto-escaping (Django, Rails, React outside `dangerouslySetInnerHTML`), or a documented internal sanitizer means do not re-flag it.

### 4. Severity, and what you do NOT own

- Map findings onto the project's existing **Block / Warn / Suggest** scale (below). Injection, exposed secrets, and insecure auth are Universal Anchors - at least Warn, usually Block. No separate CVSS vocabulary.
- **Dependency CVEs are not yours.** If the worry is a vulnerable package or version, route it to `/review-deps` (it runs `npm audit`); do not guess CVE numbers or version ranges - you will hallucinate them.

### 5. Auto-escalation nudge (one line, only when earned)

After the findings, if the change touches a genuine trust boundary - a **new** route/endpoint, file upload, or webhook; **authentication** logic; **crypto**; or **secret** handling - add exactly one line:

> _Consider `/security-audit`: this change touches [X], which deserves a deeper whole-repo pass._

Keep it to that one line and only when one of those triggers is genuinely present. If it fired on every diff you would learn to ignore it.

**Direct-call only.** This nudge is prose, so emit it only on a direct `/review-security` call. When `/review` dispatched you as a subagent (JSONL-only output), do NOT emit it - the orchestrator owns the nudge and adds it once during synthesis, so emitting it here would duplicate it and break the JSONL stream.

</procedure>

## Reading Budget

!`cat .claude/skills/shared/reading-budget.md`

## Severity Levels and Anchors

!`cat .claude/skills/shared/severity-anchors.md`

## Finding IDs

!`cat .claude/skills/shared/finding-id-system.md`

## Noise Control

!`cat .claude/skills/shared/do-not-report.md`

## Output Format

!`cat .claude/skills/shared/output-template.md`

For security findings, use the standard 4 fields, with the `Example` field carrying the source-to-sink exploit scenario described above (the attacker's-eye "an attacker could ...").

## HTML Companion (when gate fires)

After writing the markdown report, evaluate whether to also generate an HTML view. Use the shared template:

!`cat .claude/skills/shared/html-render-review.md`

For direct calls to this skill, pass `--name review-security` to the helper and omit the `chips` array (single-specialist context).

### Security Engineer Check

<guidelines>

After the standard review, step back and evaluate as a staff security engineer:
- **Attacker's eyes?** - For each new danger spot, what is the worst a malicious user could do, and did the review trace it source-to-sink?
- **New attack surface?** - What did this diff newly expose (a route, an input, a sink) that was not reachable before?
- **Trust boundary crossed?** - Does anything here warrant the deeper `/security-audit`, and did I say so?
- **Crying wolf?** - Is every finding backed by a concrete exploit sentence, or did a pattern match sneak in unproven?

</guidelines>

<rules>

## REMEMBER: Report issues only. Do NOT edit any files until I approve.

</rules>
