# Research kit

The reusable parts of a research run in this repository: how helpers keep their notes, how a run picks up after a lost helper or a lost session, how the report shows sources that disagree, and what the checker does. It is maintainer tooling, like the rest of `scripts/`, and never ships with the plugin.

Each run still writes its own brief in `reports/<topic>/` (gitignored): the goal, the questions, the readers and their shares, the labels a claim can carry, and the report's shape. Research is specific to its topic, so none of that lives here. A brief points at this file with one line:

> Follow `scripts/research/README.md` for notes, resuming, disagreements and the checker.

In this file, the **lead** is the session that runs the brief: it plans, starts the helpers, writes the report and decides. A **reader** is a helper the lead starts with the Agent tool to read one share of the sources. The **checker** is the one fresh helper that verifies the draft.

## Notes in files

Every reader keeps its findings in a file, not in its reply, so the run does not depend on any one session's memory.

- The lead starts the readers with the Agent tool and gives each one its share, the brief's questions and labels, the line formats below, and its own notes file: `notes/<reader id>.md` in the run's folder (for example `notes/R1.md`). In a cloud session, put the run's folder under `/tmp`: the repository is public, and notes are never committed.
- The reader adds each finding to its file the moment it has it, with the Write or Edit tool, never a shell redirect. A reader that is cut off keeps every line it wrote.
- Each line is one of these:
  - `- <claim> | <label> | <source actually read> | <date if known>` for a finding. The label is one the brief defines. The source is the URL or file path the reader actually opened.
  - `COULD NOT REACH: <source> - <why>` for a source that failed to load.
  - `DISAGREES: <claim A> | <source A> || <claim B> | <source B>` when the reader sees two sources say different things.
- The last line, written only when the reader has finished its whole share, is `DONE: <N> claims`, where N counts its finding lines.
- The reader's reply to the lead is only its done line. The lead reads the notes files, not the replies.
- The lead waits for the readers' notifications and never schedules a timed wake-up. In a headless run (`claude -p`), a scheduled wake-up keeps the session alive until it fires, so start a headless lead with `--disallowedTools ScheduleWakeup`. In the practice run, one lead sat idle for 27 minutes after its work was done.

## Resuming a run

Before it starts any reader, the lead looks in `notes/`. This is how a run picks up after a reader was lost to a usage limit, or after the lead's own session ended.

- A file whose last line starts with `DONE:` is finished. Keep it as it is and do not rerun its reader.
- A file without a `DONE:` line was cut off. Rerun that reader alone, give it the path of its file, and tell it to keep every line already there and add only what its share still needs. It must not rewrite, reorder or repeat the lines it finds.
- No file means the reader never started. Start it fresh.

The same rule covers a reader that comes back during the run without writing its `DONE:` line: rerun it alone, from its file. This case has not been run yet: the 2026-10-18 practice run tested only a new lead resuming after the old one was stopped.

## Where sources disagree

Before writing the report, the lead compares the claims across all the notes files and reads every `DISAGREES:` line. Two readers can each be right about their own source while the sources contradict each other, and only the lead sees both files.

The report has a section with exactly this heading: `## Where sources disagree`. For each disagreement it gives:

- both claims, each with its source written out as the URL or file path it came from, not only a reference number, so someone reading the report can judge the disagreement from this section alone;
- which one the report trusts;
- why, in one line. A direct test beats a summary of one, a primary source beats a report about it, and on a fact that changes over time, newer beats older.

When there are none, the section says `None found`. The checker can verify a disagreement the report lists, but it cannot prove that none exist.

## The checker

After the draft is written, the lead starts one fresh helper with the Agent tool and no model setting, so it runs on the session's own model. It gets the draft and nothing else from the run.

- It opens the source behind every claim in the report and marks each claim held, wrong or unsupported.
- For each disagreement, it opens both sources and confirms that each side says what the report says it does.
- The lead fixes or drops every claim marked wrong or unsupported.

The report's last line is exactly:

`Checker: N claims checked, M fixed, K dropped; D disagreements checked on both sides`

## Not in this kit

- **Search scripts**, meaning code the AI writes to run many searches or page reads at once. Readers already work in parallel, a freshly written script asks for approval on every run, and searching from a script needs a paid search API key. Reopen when a run's notes show readers waiting on one-at-a-time lookups.
- **A script that checks the notes files.** The lead tells a finished file from a cut-off one by its `DONE:` line. Reopen when a lead misjudges that, keeping a cut-off file or rerunning a finished one.
- **A `/research` command.** Research is specific to its topic, so each run writes its own brief.
- **A rule to read the `.md` copy of a page.** Claude Code's WebFetch tool already asks for Markdown (its request starts `Accept: text/markdown`). Of 36 documentation pages measured on 2026-10-18, 21 already returned Markdown at their normal address, 12 had none, and only 3 had a Markdown copy at `.md` alone. On 5 pages from those 3 sites, the `.md` copy differed from the page a person sees on 3: trimmed and rewritten on 2, a different document on 1. Read the normal address.
