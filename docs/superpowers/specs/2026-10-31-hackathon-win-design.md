# TruthLens — how to win the Meta AI Hackathon — design

## Intent

TruthLens already evaluates claims instead of summarising them. This
work makes that visible in the two minutes a judge spends with it:
a researcher or journalist picks a claim, watches Meta-powered
agents investigate it from both sides, traces where it came from,
and leaves with a transparent, exportable verdict they can publish
or build on.

Positioning, settled with the requester (2026-10-31, audience
order corrected same day):

- Track: Build for Your World. Primary audience: researchers and
  journalists, including fact-checkers. Next: truth seekers and
  lifelong learners. Then: students and nonfiction readers.
- Success is not an absolute-truth promise. It is evidence-based
  reasoning made accessible, transparent, and repeatable.
- Deadline: 4 November 2026, 21:00 ET (5 November, 04:00 SAST).

## Approaches considered

- **A. Demo-first investigation theatre (chosen).** Stream the
  LangGraph stages live, name the Meta agents as they work, surface
  disagreement and the skeptic challenge, add an exportable report,
  and script a three-investigation demo arc. Highest Demo (25%) and
  Use of Meta AI (25%) payoff for the least new machinery.
- **B. Professional-product depth.** Saved investigations,
  collections, source tracing across documents, faster repeat
  checks. Better long-term Impact with researchers and journalists,
  but a judge sees little of it in two minutes. Only the export
  from this option is pulled into A.
- **C. Scale and trust infrastructure.** Job queue, persistent
  checkpoints with resume, larger held-out eval. Strongest on
  production execution, weakest on visible payoff before deadline.

## What gets built

1. **Live investigation stream.** The single-claim check stops being
   one blocking 45–80 second wait. Each LangGraph node reports as it
   runs — triage, research (queries, sources found, fetched), judge,
   gates, challenge, assemble — and the verdict streams into the same
   view. The `trajectory` already returned by `lib/graph.mjs` is
   rendered, with the model named per stage (Muse Spark 1.3 for
   research and routine judging, Muse Wonder on escalation).
   Document investigations keep the existing SSE channel.
2. **Verdict action layer.** Every verdict view gains: clickable
   citations (already present), source-quality and uncertainty
   signals in plain language, unresolved questions, the existing
   challenge actions, and an exported investigation report
   (claim, verdict, supporting and contradicting passages with
   URLs, judge disagreement, and limits) the reader can download
   and share. No single 0–100 truth score is introduced.
3. **Scripted demo arc.** The seeded demo document reads as a
   draft under fact-check, not a classroom exercise. It carries
   three end-to-end investigations a judge can run in order: one
   Supported claim, one Contradicted claim whose skeptic round is
   the visible turning point, and one honestly Unverifiable claim.
   Candidate claims come from `eval/claims.json` and the existing
   demo book; the final three are pinned only after they pass in
   both demo mode and live mode. The demo script in the README is
   rewritten to walk this arc in about two minutes, ending on the
   exported report a journalist could attach to a story file or a
   researcher could cite in working notes.

## Reliability under non-determinism

LLM output is probabilistic, and temperature 0 does not fix that:
served inference varies with batch size, floating-point reduction
order, hardware, and silent model updates, so one run can flip a
near-tie token and cascade. Judge runs show the same instability:
repeated identical judging flips pairwise preferences about 13.6%
of the time, meaning-preserving prompt rewording changes majority
outcomes in about 25% of cases, and roughly 11 repeated trials are
needed for a majority vote to recover the stable verdict with 95%
probability. Token probabilities and single-sample verbalised
confidence are unreliable reliability signals, especially after
instruction tuning; semantic consistency across independent samples
is the best-supported signal. Retrieval grounding helps on average
but can backfire when retrieval quality is poor, and multi-agent
debate does not reliably beat simpler self-consistency.

Design consequences for TruthLens:

- **A verdict is a distribution, not a point.** Decisive and
  high-impact verdicts get a stability check: the judge stage runs
  more than once on the same fetched evidence, and the verdict view
  shows the run count and whether runs agreed. Unstable verdicts
  downgrade toward `Partially supported` or `Unverifiable`, in
  line with the existing gates — never the other way.
- **Consistency, not stated confidence.** No model-stated
  confidence, token score, or single 0–100 number is shown as
  reliability. The existing split stays: faithfulness to cited
  passages and evidence strength are separate signals, joined by
  cross-run agreement when the stability check runs.
- **Every verdict carries its conditions.** The exported report
  records model names, prompt version, run date, run count, and
  agreement, so a researcher or journalist can state exactly what
  produced the verdict and re-run it later. A changed verdict on
  recheck is reported as change over time, not an error to hide.
- **Evaluation reports error bars.** `eval/claims.json` results are
  reported as agreement across repeated trials with a flip rate,
  not as a single pass count. Prompt or model changes are judged
  on repeated runs before they ship.
- **Demo honesty.** The demo arc does not claim the same claim
  always yields the same verdict. It claims the evidence, the
  citations, the disagreement, and the abstention behaviour are
  inspectable every time — that is the truthfulness guarantee.

## Rules that match the existing principles

- No new verdict logic. Streaming and export present the gated
  pipeline output; they never re-judge or soften a verdict.
- Demo verdicts are never labelled live, live failures still yield
  `Unverifiable` with mode `live-failed`, and citations still
  resolve only to fetched, screened passages (`docs/PRINCIPLES.md`).
- A stage that has not run is never shown as run. If streaming
  fails, the blocking result still renders and says so.
- Export contains only what the verdict record holds: no invented
  confidence, no source-quality claim the pipeline did not make.

## Goals, non-goals, anti-goals

- Goals: a judge can run the full upload → choose → investigate →
  verdict → act loop unaided; the Meta models' roles are visible
  in the product, not only in the README; three investigations
  (Supported, Contradicted, Unverifiable) pass end to end; and a
  decisive verdict shows whether repeated judging agreed, with
  instability visibly downgrading it instead of being averaged
  away.
- Non-goals: accounts or newsroom integrations, a jobs queue,
  persistent LangGraph checkpoints, new providers, crawling a
  whole website, native mobile.
- Anti-goals: a demo that passes only with a canned live verdict;
  a progress display that shows reasoning the agents did not do;
  collapsing faithfulness and evidence strength into one score.

## Left to the builder

- Transport for the single-claim stream (SSE route mirroring the
  document events route, or streamed response), provided progress
  events carry stage name, model, and counts, and the final event
  carries the unchanged verdict record.
- Export format (printable HTML or Markdown download), provided
  every cited passage keeps its source URL and the report states
  the verdict's limits.
- Stability-check run count and cost budget, provided decisive
  verdicts never rest on a single judge run and the count used is
  shown on the verdict. The research benchmark is about 11 runs
  for 95% stability; the shipped count is a stated trade-off
  against the 45–80 second live-check cost, not a silent one.
- Exact demo-arc claims, pinned by test in both modes before the
  README script names them.
