# TruthLens Principles

These principles outrank features, speed, and cost. When a feature and a
principle conflict, the feature changes or waits. Trade-offs are accepted
openly: more abstentions, slower verdicts, and higher cost are the price of
verdicts a user can defend.

## Invariants

1. **No verdict without fetched evidence.** A decisive or partial verdict
   requires at least one cited passage that our own fetcher retrieved,
   screened, and relevance-checked against that specific claim.
   (`applyCitationGate`, SSRF-guarded fetcher, passage relevance filter.)
2. **Citations are validated, never trusted.** Every cited ID must resolve
   to a fetched evidence item, in code, before a verdict is stored or shown.
3. **Abstention is a correct answer.** `Unverifiable` beats a confident
   guess. Challenges, revisions, and roll-ups may move a verdict toward
   `Unverifiable` or `Partially supported`, never toward decisiveness
   without the evidence for it.
4. **A compound claim is only as strong as its weakest element.**
   Roll-ups: a decisive verdict requires every atomic element to be
   decisive and in agreement; anything less is `Partially supported`
   or `Unverifiable`.
5. **Stances come from the judge, partitions from no one else.**
   Unknown stance is shown as unclassified, never inferred from the verdict.
6. **Corroboration before confidence.** A decisive verdict needs two
   independent domains. Single-source support is downgraded to
   `Partially supported`; single-source contradiction stays `Contradicted`
   with a recorded solidity limit, because `Partially supported` would
   falsely imply the claim holds in part. One source, however good,
   is one source.
7. **Annotations never change verdicts.** Forensics discrepancies, priority
   scores, and contradiction-map links describe evidence; only the gated
   judge pipeline decides verdicts.
8. **Positions are not disagreements until verified.** The contradiction
   map links what authors claim; it labels a disagreement verified only
   when the underlying verdicts support that reading.
9. **Self-correction is bounded and recorded.** One challenge round,
   revisions pass through every gate again, and both verdicts stay visible.
10. **No single truth score.** Significance-weighted reporting shows
    consequential disputes first; an average must never hide them.
11. **The author's stance is not evidence.** Excerpt passages show what the
    author says about a reader's theory; only independently fetched
    external evidence can move a verdict.
12. **Not yet verified is a visible state.** Every extracted claim is
    preserved and labelled until someone — the automatic pass or the
    reader — actually investigates it. Coverage counts only investigated
    claims.
13. **Challenges add, never overwrite.** A reader challenge is a new
    recorded investigation appended to a claim; the original verdict
    stays on record beside it.
14. **Faithfulness is not factuality.** Every verdict reports faithfulness
    to its cited passages and the strength of that evidence base as two
    separate signals; neither is collapsed into a confidence score.
15. **Abstention thresholds are calibrated, not felt.** Conformal advice
    appears only when a threshold was fitted on labelled verdicts
    (`TRUTHLENS_CONFORMAL_Q` from `npm run eval`); otherwise no advice is
    shown. Every budgeted source is fetched: marginal-gain early stopping
    was measured, found to risk late novel evidence, and removed —
    verdict quality outranks fetch savings. The same rule governs the
    judge's context: utility ranks budgeted evidence, it never cuts it.

## Accepted trade-offs

- More `Partially supported` and `Unverifiable` results than a typical
  fact-checker would emit.
- Roughly 45–80 seconds and multiple model calls per live claim; excerpts are
  capped at 20 deep verifications with the deferred count displayed.
- Live failures produce no verdict instead of a canned one.
