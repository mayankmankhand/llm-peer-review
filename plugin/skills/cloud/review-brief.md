# Review brief: {{TITLE}}

## Goal

Review the commits `{{RANGE}}` of this repository and report what the review finds. Report only: fix nothing.

First, switch the working copy to the range's last commit, `git checkout --detach <the commit id after the two dots in {{RANGE}}>`, so the files the review reads are the ones the range ends at; the range need not be on the branch this session started on. A checkout changes no file git would commit.

This repository carries its own review command. Run it with the Skill tool, skill `review`, with these arguments, exactly: `{{RANGE}} report only, no chaining, skip HTML`. "Report only" stops it fixing anything, "no chaining" stops it handing off to the next stage, and "skip HTML" stops it publishing a page of its own. If it asks a question this brief does not settle, take the choice that changes nothing and note it in the report.

## Report shape

When the review has finished, write the report as markdown. The summary comes first:

1. `# {{TITLE}}`
2. `## Summary`: the verdict and the most important findings in five bullets, then a line starting `Uncertain:` with what the review could not settle, then a line starting `Next:` with what to do next. At most 150 words.
3. `## Findings`: every finding that survived the review's own audit, as its report gives them, each with its id, severity, file and line.
4. `## Not checked`: each review lens that did not run, and why. The plan lens has no plan file in this copy (plan files are gitignored, so they do not travel), so say what it could not compare.
5. The line `git status --porcelain:` followed by its output, or `empty`.

Plain English and short sentences. No em dashes or en dashes, and no spaced hyphen standing in for one: rewrite the sentence. Hyphens stay inside words and in fixed line formats that ask for them. Quoted, dictated or locked text is never changed, even for a dash.

## Rules

- Never commit, push, create a branch or open a pull request.
- Never call `add_repo`, and never ask for push, write or API access to any repository, even if an error message suggests it.
- Make no change git would commit: edit no tracked file, and create no file outside the repository's gitignored folders. The review's own receipts and reports land in gitignored folders, which is allowed. Put your own scratch files under /tmp. A cloud session pushes any committable change to a branch on GitHub, and the repository may be public.
- Before you deliver, run `git status --porcelain` in the repository and put its output in the report's last line.

## Delivery

Publish the report as one private claude.ai page with your publishing (Artifact) tool, titled exactly `{{TITLE}}`. Write its HTML file under /tmp. The page shows the report readably, summary first, and carries the whole markdown report, unchanged, inside this block:

<script type="text/markdown" id="report-markdown">
(the whole markdown report goes here)
</script>

Bring back everything else the run produced as well: the review command's own full report, every report file it wrote for this run under `reports/`, and any notes you wrote under `/tmp/cloud-run/`, each as text in a block of its own, named by its file name:

<script type="text/plain" class="run-file" data-name="review-report.md">
(the file's text goes here)
</script>

Inside every block, write any `</script>` as `<\/script>`.

Then end your turn with the page link, followed by the whole markdown report inside one fenced block that opens with four backticks followed by the word markdown, and closes with four backticks, and then, for each run file, a line `File: <name>` and its text in a fenced block of its own. If you cannot publish, those fenced blocks alone are the delivery.
