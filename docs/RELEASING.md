# Releasing (Maintainer)

Users receive the plugin from a release tag, not from main: from 7.1.0 the `tk` entry in `.claude-plugin/marketplace.json` pins the tag `v<version>`, so nothing merged to main reaches anyone until a release tags it.

**Once per clone, install the pre-push hook:**

    bash scripts/setup/install-hooks.sh

It points this clone's git hooks at `scripts/git-hooks/`. Every push then runs the M11 tripwire, and a push to `main` or to a tag named `v` followed by a digit (the hook matches `refs/tags/v[0-9]*`, so `v7.1.0` counts and `vendor-snapshot` does not) also runs the release gate and is blocked when the gate fails. Push from a checkout of what you push: the hook hands the tripwire git's own list of what is being pushed, and the tripwire scans the commits HEAD adds to each destination (from the remote's copy of that branch, or from the remote's default branch for a branch or tag the remote does not have yet), so the hook refuses any pushed branch or tag that is not the checked-out commit (for example `git push origin other-branch`, or a tag pushed while you stand on a later commit) and says where to push it from. Undo with `git config --unset core.hooksPath`. In a clone without the hook, run the same check by hand before a push, naming its destination: `node .claude/scripts/pre-push-check.js origin <branch-or-tag>`.

**Everyday tests** are `npm test`. It runs the release gate with `--tests-only`: every suite, the `plugin/` build check, the README word budget (`README.md` stays at or under 1,500 words; the manual lives in `docs/`) and the prompt ceiling (below), skipping the version, marketplace and tag checks, which fail on purpose between releases. It also prints the prompt-load report: the words each command, skill and agent loads, against `scripts/prompt-load-baseline.json`, with one line per row that grew. The report warns on growth and never fails on it; after a deliberate change, record the new numbers with `node scripts/prompt-load.js --write-baseline`. Beside it, the prompt ceiling check fails the run when any one prompt file loads more than `PROMPT_LOAD_CEILING` words (11,000 from 8.0.7: the biggest row after the #261 cycle, `commands/document.md` at 9,898, times 1.1, rounded up to the next 500; the session row is not a prompt file and is left out). When it trips, trim a fragment the file pastes or load that fragment at the phase that needs it, as the review family does, and never raise the constant without writing the new measurement and its date into its comment. GitHub Actions runs the same command on every push and pull request (`.github/workflows/test.yml`, Node 22, full history because one suite reads an old release tag). `npm run test:release` is the full gate.

**The release gate** is `node scripts/release-check.js`. It runs every `scripts/test-*.js` suite, its own `scripts/test-release-check.js` included (only exit codes count; that test points the gate only at scratch repos, so it cannot recurse), checks that `plugin/` matches its source (`node scripts/build-plugin.js --check`), checks that `README.md` holds at most 1,500 words (the README is the front door; detail belongs in `docs/`), checks that no prompt file loads more than `PROMPT_LOAD_CEILING` words (the prompt ceiling described under Everyday tests), checks that the version in `plugin/.claude-plugin/plugin.json` went up if `plugin/` changed since the previous release tag, checks that the marketplace entry is a `git-subdir` source whose `url` names this repository (read from the clone's `origin` remote; `owner/repo`, `https://github.com/owner/repo` and `git@github.com:owner/repo`, with or without `.git` on the last two, all count) on path `plugin` pinned to ref `v<version>`, and checks that the tag `v<version>` exists locally on the checked commit or one of its ancestors. On a push to `main` the hook also has it ask the remote being pushed to for that tag, which must already be there on the same commit, so main cannot go out before its release tag (a remote that cannot be reached blocks the push). That holds even when the same push carries the tag: `git push` is not atomic, so a tag the remote refuses (it already holds that name at another commit) would still let main land. Each check prints one `ok` or `FAIL` line with its reason.

**The suites run side by side.** The gate runs them in a pool of your CPU count less one, longest first by their last recorded times; `--jobs <n>` sets the pool and `--jobs 1` runs them one at a time. Each suite gets its own temp folder (`TMPDIR`, `TMP` and `TEMP`), which must lie outside any git work tree, and its own process group, so a suite past its 10-minute limit is stopped with everything it started and reported as `error ETIMEDOUT`, and Ctrl-C stops them all. `TK_RELEASE_SUITE_TIMEOUT_MS` changes the limit. Each suite's line prints as it ends, and a last line gives the count, the wall time and how many ran at a time. The slowest suite, `test-upgrade-audit.js`, splits itself into four parts that run at once (`--part <k>/4` runs one alone, without the checks that need every part's totals). On a 12-core machine the full run went from about 150 to about 29 seconds (#249).

**A push reuses a pass on the same files.** When every suite of the default set passes and the files did not change while they ran, the gate records the pass in this clone's git folder as `tk-release-gate.json`: the files' fingerprint (tracked, edited and new files), HEAD, and each suite's seconds. The pre-push hook adds `--reuse-pass`, which skips the suites when the files still match that record and every commit being pushed is the recorded HEAD, and says so in one line. So a green `node scripts/release-check.js` followed by the tag push and the main push runs the suites once. `npm test` and a run you type never reuse a pass, and `--reuse-pass` cannot be combined with `--suites` or `--skip-suites`.

**Before a release,** run one full cycle (`/explore` through `/document`) in a scratch project in default permission mode (`claude --permission-mode default`), with `TK_LEDGER_DIR` set to an absolute scratch folder so the run never writes into your real correction ledger. Every suite passed on the 7.1.0 changes that still shipped a review that saw nothing and commands that stopped for approval (#181, #182); only a real session in default mode shows those. `scripts/setup/headless-session.sh` runs that session for you under a scratch home (your credentials linked in, the stable plugin path linked to the build you name, `TK_LEDGER_DIR` set), and its `--baseline` and `--verify` modes prove the real `~/.claude` came through untouched.

**Keep that session away from your real setup (#189).** Always move the whole home through that script, never only the plugin: with `--plugin-dir` and `--settings` alone, a 7.2.0 session wrote into the real plugin registry and read the installed manual instead of the build under test. A run looks like this:

    bash scripts/setup/headless-session.sh --baseline /tmp/tk-baseline.txt
    node scripts/build-plugin.js --out /tmp/tk-build/plugin --version 7.3.1
    bash scripts/setup/headless-session.sh --build /tmp/tk-build/plugin --project /tmp/tk-project \
        --home /tmp/tk-home --mode default -- --output-format json "/tk:explore add a footer"
    bash scripts/setup/headless-session.sh --verify /tmp/tk-baseline.txt

Pass `--resume <session-id>` (from the JSON) with the same `--home` to answer a question the session asked. Each turn's `permission_denials` lists the calls that would have stopped for approval.

**Build into a cache-shaped folder when the run must show the plugin's own script calls.** Setup fills the plugin script rows only for a plugin that runs from a `plugins/cache/<marketplace>/tk/<version>` folder, so a build anywhere else gets none, and a render or another script call is denied where a real install allows it. Pass `--out <scratch>/plugins/cache/llm-peer-review/tk/<version>` to `build-plugin.js` and hand that folder to `--build`.

**Headless sessions cannot edit files under `.claude/` outside `bypassPermissions`.** A `-p` session cannot answer a prompt: default mode and `acceptEdits` both stop on a `.claude/` path, and project allow rows `Edit(.claude/**)` and `Write(.claude/**)` do not change that. `bypassPermissions` gets through, but it also stops checking shell commands, so it cannot show which steps would ask. When one scenario must both edit prompt files and count prompts, split it before the run: the edit steps in `bypassPermissions`, the prompt count from the default-mode sessions.

**Release order.** Release notes go to `CHANGELOG.md`, never the README: the README stays under 1,500 words and the gate counts it on every run. Write them first: the plugin ships every released block of `CHANGELOG.md` up to its own version and never an `## Unreleased` block, so turn this release's Unreleased blocks into one `## v<new-version> - <title> (<date>)` block before step 1, and the bump's rebuild carries it into `plugin/CHANGELOG.md`.

**The steps:**

1. Regenerate the seed history, then bump the version. `node scripts/seed-history.js` rewrites `seed/historical-seed-blocks.txt` (every seeded block each release from v6.0.0 shipped, hashed, for the upgrade audit's C-15) and `seed/toolkit-lesson-leads.txt` (every bold lead the toolkit's own `LESSONS.md` has carried, for C-16) from the release tags and the working tree, then rebuilds `plugin/` so the build check stays green; commit both with the release. Then bump: `bash scripts/setup/bump-version.sh <new-version>`. The script updates VERSION, package.json, package-lock.json (if present), and the version stamps in the three stamped files (the seeded `.claude/rules/toolkit.md`, `.claude/skills/shared/toolkit-reference.md`, `.claude/skills/shared/html-outputs.md`), then rebuilds `plugin/`.
2. In the same change, set the `tk` entry's `source` in `.claude-plugin/marketplace.json` to the full `git-subdir` object below, and do the manual steps below. Commit all of it as one release commit. The gate checks every field, `url` included, against this clone's `origin`.

   ```json
   "source": {
     "source": "git-subdir",
     "url": "mayankmankhand/llm-peer-review",
     "path": "plugin",
     "ref": "v<new-version>"
   }
   ```

3. Tag the release commit `v<new-version>` locally (the gate checks that the tag exists), then run `node scripts/release-check.js` until it is green. If a fix needs another commit, move the tag onto it with `git tag -f v<new-version>`; nothing is published yet.
4. With the release commit still checked out, push the tag. The hook runs the gate again, including the check that the tag matches the version in its commit's `plugin.json`.
5. Merge to main and push main from a checkout of `main`, as its own push after the tag. The gate confirms the tag is already on that remote at the same commit. If step 3 moved a tag that was already pushed, the remote still holds the old commit and the gate blocks main until that is resolved.
6. Cut a GitHub release with `gh release create v<new-version>` so the latest release on GitHub matches the tag users install.

Manual steps for the release commit:

- The new CHANGELOG.md section, written before step 1 (see Release order above)
- Update AGENT-SETUP.md title and "What's new" block (rename the previous block to "What was new in vX.Y", and keep only the last three blocks inline - older entries point at CHANGELOG.md)
- If this release bumps a default model, follow the model-bump reminder printed by `bump-version.sh`: append the OLD `DEFAULT_*_MODEL` value to `KNOWN_STALE_*_MODELS` FIRST, then update `DEFAULT_*_MODEL` to the new value, then update `.env.local.example` and `API-KEYS.md`
- If the installers changed since the last release, run `bash scripts/setup/test-installer-guarantees.sh` (and the `.ps1` mirror on Windows) before tagging; it is not a `scripts/test-*.js` suite, so the gate does not run it
