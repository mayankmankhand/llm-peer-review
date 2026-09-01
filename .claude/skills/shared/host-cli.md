# Host CLI (gh / glab)

Shared reference for every command that touches issues, pull requests, or merge requests. Inlined via `` !`cat .claude/skills/shared/host-cli.md` ``.

The toolkit runs on GitHub and GitLab. Nothing about the install differs by host: the host is read from the repo itself, at the moment it is needed. There is no setting to configure and no state to keep in sync.

**Run the detection in the same block as the command it guards.** If you skip detection, skip the command too. Never fall through to a bare `gh`.

## Detect the Host

1. Read the origin remote: `git config --get remote.origin.url`
2. Match that output as a **substring**. Do not parse it as a URL: the SSH form (`git@github.com:owner/repo.git`) and the HTTPS form (`https://github.com/owner/repo.git`) do not parse alike.
   - contains `github.com` -> use `gh`
   - contains `gitlab.com` -> use `glab`
3. Neither matches (self-hosted GitLab, GitHub Enterprise, or no `origin` remote). Fall back to whichever CLI is installed, via `command -v gh` and `command -v glab`:
   - exactly one installed -> use it
   - both installed -> ask the user once, then reuse that answer for the rest of the session
   - neither installed -> stop, and tell the user to install `gh` or `glab`

## Invocation Table

Flags **and** output field names differ between hosts. Use the whole row, not just the binary name.

| Action | GitHub (`gh`) | GitLab (`glab`) |
|---|---|---|
| Create issue | `gh issue create --title "T" --body "B" --label "L"` | `glab issue create --title "T" --description "B" --label "L"` |
| Read issue | `gh issue view <N> --json title,body` -> fields `title`, `body` | `glab issue view <N> --output json` -> fields `title`, `description` |
| Create PR / MR | `gh pr create --base main --title "T" --body "B"` | `glab mr create --target-branch main --title "T" --description "B"` |
| Most recent PR / MR (URL) | `gh pr list --limit 1 --json number,url` -> field `url` | `glab mr list --per-page 1 --output json` -> field `web_url` |
| Most recently merged | see the fenced block below | see the fenced block below |

The merged-PR lookup is the one call where a table cell would mangle the command, because a `|` inside a markdown cell has to be escaped and the escape would reach the shell. Run these exactly as written:

```bash
# GitHub - most recently MERGED PR, and its merge commit SHA
gh pr list --state merged --json number,mergedAt,mergeCommit \
  --jq 'sort_by(.mergedAt)|reverse|.[0].mergeCommit.oid'

# GitLab - same thing. The server does the sorting, so no jq binary is needed.
# The `=` in --jq= matters: a space-separated expression can parse as a subcommand.
glab mr list --merged --order merged_at --sort desc --per-page 1 \
  --output json --jq='.[0].merge_commit_sha'
# Empty output means the newest merged MR was IMPORTED and has no merge_commit_sha.
# Fall back to: git log --merges -1 --format=%H
```

## Notes

- **"PR" throughout the toolkit means "MR" on GitLab.** The prose keeps one word for readability; only the commands differ.
- **Never take the first row of a merged list without ordering it first.** Left alone, `gh pr list --limit 1` and `glab mr list --per-page 1` both sort by CREATION date, not merge date, so either one returns a stale entry when an older PR is merged late. The two hosts fix this differently, which is why the block above is not symmetrical: `gh` has no server-side merge-date sort, so it fetches a page and sorts in `--jq`; `glab` takes `--order merged_at --sort desc`, so the server returns the right row and `--per-page 1` is safe.
- On a GitLab issue URL, the number is not the last segment of a fixed-depth path: groups nest arbitrarily and `/-/` separates the project path from the resource. **GitLab serves the same issue under two paths** and the API returns the second one: `glab issue view <N> --output json --jq='.web_url'` prints `/-/work_items/<N>`, not `/-/issues/<N>`. Anchor on `/-/(issues|work_items)/(\d+)` for GitLab and `/issues/<N>` for GitHub, take the LAST such match, and ignore any trailing `/`, query string, or `#` fragment. `glab issue view` accepts either form and a bare number interchangeably, so the number is all you need once it is extracted.
- **The GitLab column has been executed** against `glab 1.115.0` on a live repo (~270 issues, 31 merged MRs). Every row above ran as written, and GitHub-style `--body` / `--base` correctly error with `Unknown flag`. One version caveat remains untested: `--output json` has moved between glab builds, and older ones want `-F json`.
- **Imported MRs carry an empty `merge_commit_sha`.** On a repo migrated from GitHub, MRs created by the import have no merge commit - 29 of 31 in the tested repo. The lookup then returns an empty string rather than an error, which yields a malformed commit range downstream. Treat empty output as "not found" and fall back to `git log --merges -1 --format=%H`, as the block above says.
