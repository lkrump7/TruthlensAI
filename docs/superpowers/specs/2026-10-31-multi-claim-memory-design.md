# Multi-claim queue and comprehensive memory

## Intent

A reader checks one claim, then another, then a whole list. Today the
standalone checker holds one line, keeps the last verdict on screen, and
drops earlier verdicts into a short list that lives only in the tab.
Reload and it is gone. The standalone routes store nothing on the server.

Books and websites already persist. Their claims, verdicts, challenges,
and recheck history survive a reload. The fix extends that proven path
to standalone claims instead of inventing a second store.

The point is user experience, not storage for its own sake. A reader
should never lose their place, never retype a claim, and should be able
to reopen any past check with its full evidence.

## Goals

- Paste or dictate several claims at once. One claim per line.
- Run them as a queue. Each claim shows its own state and verdict.
- Submit again right away. Earlier verdicts stay visible below.
- Every finished standalone verdict is saved on the server.
- One History view covers all four workflows. Single claims, book
  claims, website claims, and questions asked of a source all appear in
  one searchable list.
- Reopen any history row to see the full verdict and evidence again.
- Restore the typed queue after a reload, before anything is run.
- Search history by words, and narrow it by verdict or workflow.

## Non-goals

- No new account system. History follows the current owner rules. With
  accounts off, everyone shares the workspace history. With accounts on,
  a reader sees their own history plus the demo book.
- No resume of a half-finished live investigation. The graph checkpoint
  stays as it is. History stores finished verdicts.
- No change to verdict logic, evidence rules, or the demo arc.

## Approaches

Three ways were considered.

Server history reusing document persistence. Standalone verdicts are
appended to a history document held by the existing repository, file or
Postgres. History reads across every document the reader can see. This
was picked. It is the only option that is true across all workflows and
survives a restart.

Browser-only memory. Fast, but lost when site data is cleared and blind
to book claims. Rejected.

Hybrid. Server results plus browser drafts. The draft part is kept, as a
typing aid only. Finished verdicts live on the server.

## Design

### Batch parsing

`parseClaimBatch` in the history module takes a block of text or a list.
It trims each line, drops blanks, drops exact duplicates while keeping
the first occurrence, and caps the batch at ten claims. Order is the
order typed.

### History document

Each owner has one history document, created on first use. Its kind is
`history`. It holds no chunks and extracts no claims from text. Finished
standalone verdicts are appended as claims with `source` set to
`standalone` and `workflow` set to `claim`. Writes to one history
document are serialized, so two verdicts landing together cannot
overwrite each other.

### Unified history read

`listHistory` loads every document the reader can see and flattens the
verified claims into entries. Each entry carries the claim text, the
verdict, who judged it, when it was judged, the workflow it came from,
and the document title. Book, website, and reader-submitted claims need
no extra write. They are already on their documents, and history reads
them from there. Results sort newest first and can be narrowed by a
word search, a verdict, or a workflow.

### Batch verify

`verifyClaimBatch` runs the parsed claims with the same concurrency
limit documents use, keeps the results in typed order, and records each
finished verdict. One failing claim does not sink the rest. Each result
says what happened to that claim.

### Routes

`POST /api/verify/batch` takes a list or a block of text, runs the
queue, and returns one result per claim.

`POST /api/verify` and the streaming twin record their finished verdict
before answering, on a best-effort basis. A store failure never hides a
verdict the reader already earned.

`GET /api/history` returns the unified entries, with word, verdict, and
workflow filters taken from the query string.

### Page

The claim box becomes a multi-line box, one claim per line. Dictation
appends to it. The queue shows one row per claim, waiting, running, or
done, and the verdicts stack below so they can be compared. The typed
text is kept in the browser as a draft and restored on reload.

Library gains a History section. It has a search box, verdict and
workflow filters, and one row per past investigation. Picking a row
reopens the full verdict view. Standalone rows reopen in place. Book and
website rows open their document claim.

## Error handling

An empty batch is a 400 with a plain message. A claim over the length
limit fails that claim, not the batch. A history write that fails is
logged and the verdict is still returned.

## Testing

New tests cover batch parsing, history persistence across a fresh read,
unified listing across workflows, batch order and single-failure
isolation, and the two new routes. The existing suite must stay green.
