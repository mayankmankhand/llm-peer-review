# Research brief: {{TITLE}}

## Goal

Answer this question in a plain-English report: {{QUESTION}}

The reader builds with AI tools and can read code but does not write it professionally. The aim is understanding: do not install, run or build anything you read about.

You are the lead: you plan, write and decide. Six helpers do the reading and one checker verifies the result.

Known starting points: {{STARTING_POINTS}}

## Readers

Split the question into six shares that do not overlap, one per reader: for example the subject's own writing, its docs, its code and history, independent coverage, criticism, and the numbers. Spawn the six helpers with the Agent tool, all at once, each with its model set to `sonnet`. Give each one its share, the question and the finding format below.

Finding format. Every reader returns this and nothing else:

- Up to 15 lines, each: `<claim> | <label> | <URL or file path> | <date if known>`
- Labels: `[primary]` the subject's own code, docs or posts, `[outside]` anyone else, `[unconfirmed]` could not be verified from a source.
- Then one line, `Could not reach:` followed by the sources that failed to load, or `none`.

If a reader is lost to a usage limit, rerun only that reader, and tell it what it already covered so it reads only the rest.

Keep everything the run produces in one folder, `/tmp/cloud-run/`, so it can all come back: save each reader's findings, word for word, as `reader-1.md` to `reader-6.md`, and any notes, data or drafts you write for this run beside them.

## Checker

After you write the draft report, spawn one fresh helper with the Agent tool and no model setting, so it runs on this session's model. Give it the draft. It opens the source behind every claim and marks each one held, wrong or unsupported. Save its verdicts, word for word, as `/tmp/cloud-run/checker.md`. Fix or drop every claim it marks wrong or unsupported.

## Report shape

Write the report as markdown. The summary comes first:

1. `# {{TITLE}}`
2. `## Summary`: the answer in five bullets, then a line starting `Uncertain:` with what the sources leave open, then a line starting `Next:` with what to do next. At most 150 words.
3. `## Findings`: the full report, one claim per bullet, each carrying its label.
4. `## Sources`: a numbered list, each entry a URL or file path with a short title.
5. The line `Checker: N claims checked, M fixed, K dropped`.
6. The line `git status --porcelain:` followed by its output, or `empty`.

Plain English and short sentences. Explain each technical term the first time it appears. No em dashes or en dashes, and no spaced hyphen standing in for one: rewrite the sentence. Hyphens stay inside words and in fixed line formats that ask for them. Quoted, dictated or locked text is never changed, even for a dash.

## Rules

- Never commit, push, create a branch or open a pull request.
- Never call `add_repo`, and never ask for push, write or API access to any repository, even if an error message suggests it.
- Make no change git would commit: edit no tracked file, and create no file outside the repository's gitignored folders. Put your own scratch files under /tmp. A cloud session pushes any committable change to a branch on GitHub, and the repository may be public.
- Keep the run to the six readers and the one checker above.
- If a source cannot be reached, say so in the report rather than guessing.
- Before you deliver, run `git status --porcelain` in the repository and put its output in the report's last line.

## Delivery

Publish the report as one private claude.ai page with your publishing (Artifact) tool, titled exactly `{{TITLE}}`. Write its HTML file under /tmp. The page shows the report readably, summary first, and carries the whole markdown report, unchanged, inside this block:

<script type="text/markdown" id="report-markdown">
(the whole markdown report goes here)
</script>

Bring back everything else the run produced as well: every file in `/tmp/cloud-run/` (the readers' findings, the checker's verdicts, and any notes, data or drafts), each as text in a block of its own, named by its file name:

<script type="text/plain" class="run-file" data-name="reader-1.md">
(the file's text goes here)
</script>

Inside every block, write any `</script>` as `<\/script>`.

Then end your turn with the page link, followed by the whole markdown report inside one fenced block that opens with four backticks followed by the word markdown, and closes with four backticks, and then, for each run file, a line `File: <name>` and its text in a fenced block of its own. If you cannot publish, those fenced blocks alone are the delivery.
