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

# GitLab - same thing. Sort on merged_at; do NOT just take the first row.
glab mr list --merged --per-page 50 --output json \
  | jq -r 'sort_by(.merged_at)|reverse|.[0].merge_commit_sha'
```

## Notes

- **"PR" throughout the toolkit means "MR" on GitLab.** The prose keeps one word for readability; only the commands differ.
- **Never take the first row of a merged list.** `gh pr list --limit 1` and `glab mr list --per-page 1` both sort by CREATION date, not merge date, so either one returns a stale entry when an older PR is merged late. Sort on `mergedAt` / `merged_at` explicitly, as the block above does.
- On a GitLab issue URL, the number is not the last segment of a fixed-depth path: groups nest arbitrarily and `/-/` separates the project path from the resource. Anchor on `/-/issues/<N>` for GitLab and `/issues/<N>` for GitHub, take the LAST such match, and ignore any trailing `/`, query string, or `#` fragment.
- **The GitLab column has not been executed** (no `glab` on the authoring machine). Two things to check first if it errors: `--output json` has moved between versions (older builds use `-F json`), and `--jq` is a `gh` flag rather than a `glab` one, which is why the GitLab command above pipes into `jq` instead. If both fail, fall back to `git log`.
