# Papercuts

A papercut is a small, non-blocking friction someone hit while working in this
repo AND that has a fix here: a tool call that dead-ended, a broken link, a
flaky command, a stale cache, a misleading error, an undocumented setup step.

One or two sentences each: what you were doing, then what got in the way. A
guess at the cause or fix is a bonus. Log these in the moment, even though none
of them block you. Together they show where this repo needs sanding down.

A papercut must have a fix in the repo — a step to document, a flaky command to
stabilize, a misleading error to clarify, a dead-end to remove. It is NOT a
lesson, a memory, or a note-to-self ("remember to do X next time" is a lesson,
not a papercut). It is also different from a worklog (what you accomplished) and
from tracked issues (real bugs and planned work).

## Format

Each papercut is its own file: `<timestamp>-<rand>.md`. One file per entry
means two git worktrees never write the same file, so this log never causes a
merge conflict.

## Read them

    papercuts list

Files are plain Markdown. Read them directly, or collate with the command
above. The tool never commits for you; commit these files as part of your
normal commits, so they land in the repo with the related work. Do not make a
commit only for papercuts.
