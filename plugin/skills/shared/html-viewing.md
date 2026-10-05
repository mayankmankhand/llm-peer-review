# HTML Viewing Rules

How a page that `render-html.js` wrote reaches the user. When to render, where the file lands, and how the helper writes it are in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`.

## Viewing the Artifact

HTML artifacts are meant to be *viewed rendered in a browser*, not read as source. Do not hand the user a file link and stop: in an editor like Cursor or VS Code, clicking a file link opens the HTML source, which is exactly the friction this rule removes.

There are two viewports. **The hosted page is the primary one; the local browser open is the fallback.** This is the one decision, and every command points here rather than restating it:

```
render-html.js has printed a path
  -> Can this session publish? (the countable gate below)
    -> NO:  open it locally with open-artifact.sh. Done - this is the whole flow.
    -> YES: the render should have used --no-abs (see "Render for the viewport")
      -> publish to the private claude.ai page, record it (which stamps the local file), hand over the URL.
```

A user is never left with only a file path. Whichever branch runs, exactly one viewport opens, and neither branch asks the user for permission first; "Publishing the Artifact" below says why, and lists what is still gated.

### Render for the viewport

**Decide this BEFORE you run the render, not after.** The flag cannot be added to a file that is already written, and every call site below prints a copy-ready command; check the publish gate first, then run the command with or without the flag accordingly.

**When the session can publish, pass `--no-abs` to `render-html.js`.** Five of the seven shells turn a file reference into a `vscode://file/<absPath>` editor link, so without the flag a published page carries this machine's directory layout and account name. The flag deletes those absolute paths, and each of the five shells then renders that file reference as plain text rather than as a link - an editor link built from a relative path would leak nothing but be dead for every viewer. Those editor links only ever resolved on the machine that made them anyway, so they were dead for any other viewer. It also rewrites the repo root and home directory out of the page text wherever they appear as prose, so file references read as repo-relative; it does not claim to remove every absolute path on the filesystem.

The flag is keyed to the **capability gate** alone. A session that can publish renders without absolute paths, full stop: there is no later answer that could change where the page goes, so there is nothing to wait for and no second render to avoid.

A session that cannot publish renders normally and keeps its editor links, which is where they are actually useful.

### Opening it locally (the fallback)

Handing the file to the browser is not an outward-facing send: the file stays on this machine, and the browser is simply a different application opening it. This branch never asks the user for permission. If Claude Code itself asks permission to run `open-artifact.sh`, that is a permission matter, not something this rule can grant or withhold: on a copy-install, setup seeds the row into `settings.local.json`; on the plugin, each command that opens an artifact carries the grant in its `allowed-tools`, which lasts until the user's next message, and setup seeds the plugin script rows that keep it past that, so a prompt after an answered question means the project's `settings.local.json` lacks those rows: approve it once and suggest re-running setup.

Use the toolkit's opener script, which tries each platform launcher in order with real fallback and only fails when the environment is genuinely headless:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/open-artifact.sh "<file>"
```

Pass the absolute path `render-html.js` printed, typed out as literal words (see "Temporary folders" in `${CLAUDE_PLUGIN_ROOT}/skills/shared/html-outputs.md`; the script resolves either an absolute or a project-relative path). It handles macOS (`open`), WSL (PowerShell `Start-Process`, located on PATH or by full path, then `explorer.exe`), and Linux (`xdg-open`). It exits `0` when a launcher succeeded, `1` when every launcher failed or the path did not resolve; on WSL the headless message also prints the Windows-side (UNC) path so it can be pasted into a Windows browser.

- **On exit 0:** tell the user it opened, with the path, e.g. "Opened the review in your browser: `artifacts/html/review.html`".
- **On exit 1:** do not retry in a loop. The script already prints the "open this in your browser (not the editor)" guidance with the path, so relay that rather than restating it. If the path may be wrong, re-check it resolves from the project root before assuming the environment is headless.

The `/tk:playground` skill sits outside all of this: it never publishes and never auto-opens, because its output is throwaway `/tmp/` HTML the user pastes back (see the `playground` skill). It emits a clickable `file://` link in chat instead.

## Publishing the Artifact (the primary viewport)

**The gate is countable.** Publish only when a tool for publishing a file to a hosted artifact page is present in this session's tool list. When it is not (Cursor, or the feature is off for that user), skip this section silently and open locally instead. Do not mention it, do not apologise, do not suggest switching editors. The local open is a complete outcome, not a degraded one.

**No consent ask.** Publishing sends the rendered file to a page under `claude.ai` that is private by default, and the toolkit never touches a page's sharing setting. That is not an outward-facing send under M9 in `${CLAUDE_PLUGIN_ROOT}/skills/shared/hitl-loop.md`: the page reaches no one the user has not chosen themselves. So a publish-capable session publishes every artifact type - plan, document, explore, docview, audit, review, and debate alike - without asking first, exactly as the local fallback opens a file without asking. M9 names this exemption; it is one of the two outward sends M9 exempts, the other being the chained `/tk:document` PR.

**Say what a review or debate page holds.** A review or debate page can quote code excerpts and security findings the user has not read yet, and under this rule they reach the private page before the user sees them. The previous rule asked for consent at publish time on every review and debate run; on 2026-08-31 the owner judged that ask unnecessary because the page is private to their own account. The cost is that findings can land on the page before they are read, which is why, when you hand over such a link, you say in one clause what the page contains. The link is never a surprise.

**What remains gated.** Everything else in M9 stands:

- Every other M9 always-ask action: edits to prompt files, releases and version bumps, deletions of user data, force pushes.
- Any send the loop would make on its own to a destination that is not a private `claude.ai` page: an issue or PR comment, email, a shared drive. Those still ask; M9's other named exemption, the chained `/tk:document` PR, is unchanged. (`/tk:ask-gpt`, `/tk:ask-gemini`, and `/tk:peer-review` are a different gate: they run only when a human types them and are never chained into, per M14.)
- Sharing. The toolkit never changes a page from private to shared and never hands a link to anyone but the user. A request to share a page is an outward send and asks. An update to a `--stable` page the user has since shared reaches whoever they shared it with; that is the user's sharing choice, not a toolkit send.
- `/tk:error-analysis` output. It is never published and never sent anywhere, with no consent path at all; that rule is stronger than this one and is untouched.
- The M11 pre-push tripwire. Publishing an artifact is not a push; every push is still scanned.
- The `--no-abs` render for publish-capable sessions, which still runs on every render bound for a page.

**Naming is already handled.** `render-html.js` writes the payload's title into the page's `<title>`, and that tag is what names the published page. A title passed alongside the file is ignored when the file carries its own tag.

**Use a fixed icon per artifact type.** Publishing takes a tab icon, one short generic word, and the icon is how a user finds the page again among open tabs. Pass it on a page's first publish and leave it out of an update, which keeps the icon the page already has, so an updated plan does not read as a different page:

| Type | Icon |
|---|---|
| review | search |
| document | clipboard |
| explore | compass |
| debate | chat |
| audit | chart |
| plan | map |
| docview | document |

Only change a type's icon if that type's purpose changes.

**Two publish modes, matching how the file is named.**

| Types | File naming | Publish behavior |
|---|---|---|
| explore, debate, audit | timestamped, one file per run | publish a new page each run |
| review, document, plan, docview | `--stable`, one file per identity | update the one page for that identity |

For a stable type, look up its recorded page first:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --index-url --name <name>
```

It prints a URL when one has been recorded, nothing when it has not. When a URL comes back, update that page instead of publishing a new one: a plan link that changes on every re-plan is worse than no link. When nothing comes back, publish a new page. The index is keyed to the repository rather than the working directory, so this lookup finds the same record from a worktree as from the main copy.

**Record every publish.** Immediately after a successful publish:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --index-add --type <shell> --name <name> \
     --local <path> --url <url>
```

`<name>` must be the exact `--name` value used for the render, because that is the key `--index-url` looks up. `<path>` must be the path `render-html.js` printed for that render. It has to lie inside the working copy the render ran in (a worktree's own `artifacts/html/` qualifies), and the helper refuses anything outside it. The helper creates `artifacts/html/` if needed, timestamps the record itself, and appends one JSON line. It is never read-then-rewritten, so concurrent sessions cannot clobber each other.

**The record stamps the file.** In the same call, the helper writes the hosted URL onto the first line of that local file as `<!-- hosted: <url> -->`, before the doctype, so the file on disk names the page it mirrors. The index is the record; the stamp is a derived copy of it. A missing local file is a stderr warning, not a failure: the record still lands. To change a URL, append a new record with `--index-add`; it re-stamps the file. A stamp can also go missing on its own: a `--stable` re-render overwrites the file, and a file published before stamping existed never had one. `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-html.js --index-sync` re-derives every stamp from the newest record per local file and prints `index-sync: N stamped, M missing` (plus `, K skipped` when a row was refused: a path outside the repository, a non-HTML file, or a URL that is not a plain `https://` link). Only `.html` mirrors are ever stamped, and only `https://` URLs are accepted. Never edit a stamp by hand, and never stamp a markdown twin: `PLAN-*.md` is read by Claude, and the HTML file is the mirror of the page.

**Failure is not an error.** If a publish does not go through, say so in at most one line, open the file locally instead, and move on. Do not retry in a loop. Nothing is lost.

**What to tell the user.** One line with the link and the local path: "Published the review: <url> (local copy: `artifacts/html/...`)". For a review or debate page, add the one clause about what it holds.
