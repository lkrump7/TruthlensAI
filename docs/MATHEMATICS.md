# Mathematics in TruthLens

Every number the system computes, what it means, how it was verified, and
what it does not claim. Verified 2026-10-31 with Node property tests and
an independent numpy 2.5.4 cross-check (project `.venv`). The governing
rule is PRINCIPLES 14 and 15: no score is a probability unless a
calibration procedure says so, and nothing fitted ships without data
behind it.

## 1. TF-IDF embeddings and cosine similarity

`lib/vector.mjs` over terms from `lib/nlp.mjs`. Text is tokenised,
Porter-stemmed, stripped of stopwords, and expanded with adjacent
bigrams. A document vector holds, per term, `(1 + ln tf) x idf` with
smoothed `idf = ln((N+1)/(df+1)) + 1`, L2-normalised. Search is the dot
product of two normalised vectors, which is cosine similarity. The
index fits on a corpus (`add`) before transforming (`embed`, `search`);
unseen terms contribute nothing, which is standard TF-IDF behaviour.

This replaced a hashed bag-of-words (FNV-1a buckets, raw counts). The
hashed version was verified against numpy at the time (max difference
0.0) and was still the wrong tool: `brain` and `brains` shared no
bucket, and common words counted as much as rare ones.

Verification, offline benchmark (6 labelled claims, 18 passages,
relevant passages written with word variants and rare terms):

| Implementation | P@3 | MRR | hit@3 |
|---|---|---|---|
| Hashed bag-of-words | 0.444 | 0.771 | 0.833 |
| TF-IDF + Porter + bigrams | 0.667 | 1.000 | 1.000 |

The Porter stemmer is tested against the canonical stem pairs
(final Snowball stems, not Porter's per-step paper examples). The
stemmed overlap in `lib/evidence.mjs` uses the same normalisation for
relevance checks and utility scoring.

Thresholds were recalibrated to the TF-IDF cosine scale from measured
scores, not carried over: duplicate and contradiction pairs score at
least 0.877, topically distinct claims at most 0.603, so
`DEDUPE_THRESHOLD = 0.8` sits in the middle of a wide gap. Excerpt-passage
matching uses `EXCERPT_PASSAGE_THRESHOLD = 0.05`: a claim split across a
page break scored 0.088 on its first page, under the old 0.12 bar.

Two later additions, same discipline. Number words fold into digits
during tokenisation (`eighty` becomes `80`, `one hundred twenty`
becomes `120`), in retrieval terms, in claim/passage overlap, and in
number extraction for priority and forensics. Before this, `80 percent`
and `eighty percent` were simply different terms. The word `one` folds
only in `one hundred`-style sequences; as a pronoun it stays a word.
And Okapi BM25 (k1 = 1.2, b = 0.75) ranks fetched-page windows during
passage extraction, where term-frequency saturation and length
normalisation matter. On the benchmark above BM25 and TF-IDF cosine
tie (P@3 0.667, MRR 1.000); BM25 earns its place on the saturation
behaviour, proven by a test where one term repeated twenty times loses
to three distinct query terms used once. BM25 scores are unbounded, so
cosine keeps every job where a threshold is calibrated.

Limits, stated plainly:

- Still a bag of words at heart. Stemming unifies variants; it does
  not know that "myocardial infarction" and "heart attack" agree.
  Synonymy is the judge model's job, fed by this retrieval.
- Bigrams capture two-word phrases only.
- Cosine here measures weighted term overlap, not semantic
  equivalence. It is used for retrieval and ranking only, never as
  evidence of truth.

## 1b. Semantic embeddings (sidecar)

`services/sidecar.py` `/embed`, `lib/embed.mjs`. all-mpnet-base-v2
(sentence-transformers, 768 dimensions, unit-normalised, CPU by
default) embeds the claim and the fetched passages. Where TF-IDF is
blind, synonyms, this layer sees: the calibration pair "Exercise
improves memory in older adults" / "Aerobic training enhanced recall
in ageing volunteers" scores cosine 0.83, against roughly zero lexical
overlap.

How it is used, and where it is not:

- Passages the lexical gates dropped get a second chance when their
  semantic cosine to the claim reaches `SEMANTIC_RELEVANCE_THRESHOLD`.
- Every evidence item carries its `semanticScore`; the research-stage
  relevance filter accepts lexical overlap or that threshold.
- Ranking vectors for the pool cut are semantic when the sidecar
  answers for every passage, TF-IDF otherwise. Never mixed: the two
  spaces have different scales and geometries.

Threshold calibration (12 hand-labelled pairs on the real model):
relevant pairs scored 0.831, 0.826, 0.825, 0.411, 0.668, 0.737;
irrelevant pairs 0.032, 0.210, 0.327, 0.113, 0.245, 0.272. The gap
(0.327, 0.411) is clean on this small sample and 0.37 is its midpoint.
That is a calibration on twelve pairs, not a guarantee; the threshold
should be refitted on labelled output from the eval harness before
anyone leans on it harder.

Failure behaviour: no sidecar, a failed load, or a malformed reply
returns null and the pipeline runs TF-IDF only, unchanged. A full GPU
on the development machine is why the sidecar loads on CPU by default
(`TRUTHLENS_EMBED_DEVICE` overrides); a failed load is not latched, so
a later call retries.

End-to-end check: with six sources where the only on-point passage is
a synonym passage, the semantic path keeps it in the judged pool
(score 0.831) and the TF-IDF-only control drops it.

## 1c. Cross-encoder reranking, NLI, and the smaller NLP pieces

Cross-encoder reranking (`/rerank`, ms-marco-MiniLM-L-6-v2) makes the
final pool cut when the sidecar answers: it reads claim and passage
together, which bi-encoder cosine cannot. Its scores are unbounded
logits (live range observed roughly -11 to +10), ranking-only, never
thresholded. On the calibration query its synonym passage scored -3.3
against -10.6 for two off-topic passages.

NLI (`/nli`, DeBERTa-v3 MNLI) labels each cited passage entailment,
neutral, or contradiction against the claim, independently of the
judge. The verdict reports `nliChecks: {checked, agree}`: how often
the judge's stance labels and NLI agree. It is a reported check, never
a gate; a live run showed 3 of 4 agreeing, with the disagreement
visible rather than smoothed over.

Deterministic pieces: negation and hedging cues flag wording inside
cited evidence as forensics annotations (annotations never move
verdicts); in-text dates (`June 2019`, bare years) now backfill
evidence dates when page metadata has none, and relative offsets
("five years later") resolve only against a known base date; claim
splitting additionally breaks on fresh-subject "and", "and that", and
whereas/while contrasts, with noun lists guarded by an action-verb
requirement. Extraction recall is pinned by a labelled fixture in
tests/extraction.test.mjs (16 of 16 expected propositions, plus
atomicity assertions the substring fixture alone would pass without).

## 2. Evidence ranking: cosine plus a source-tier prior

`lib/rank.mjs`: `score = cosine + sourceTier x 0.04`, tiers 0 to 3
(0.12 maximum bonus). This is a ranking score, not a probability, and it
can exceed 1. The bonus can only reorder passages whose cosine scores
sit within 0.12 of each other, which is what "breaks near-ties toward
primary sources" means in practice. A passage with no token overlap
(cosine 0) and a top-tier source scores 0.12 and still loses to any
genuinely overlapping passage from a weak source.

## 3. Passage utility (judge context ordering)

`lib/evidence.mjs`: `utility = overlap x 0.1 + tier x 0.04 + length
term x 0.01`, weights named in `lib/config.mjs`. Utility orders the
judge's evidence; since the audit fix it never cuts it. The full
budgeted pool (`BUDGET.maxEvidence = 5`) reaches the judge. The weights
are felt, not fitted, and are now only allowed to affect reading order,
where a wrong weight costs little. Any future use of utility to drop
evidence needs a fitted justification first (PRINCIPLES 15).

## 4. Claim prioritisation

`lib/claims.mjs` `scoreClaimPriority`: numbers in the claim (capped at
4, x1.5), causal verbs (+3), a year (+1), a percentage (+1), repetition
across pages (+2 per extra page), readable length (+1). An ordinal
ranking for choosing which 20 claims to verify first. It is monotone in
each signal by construction (verified) and claims nothing else. It
never affects a verdict.

## 5. Uncertainty: faithfulness and evidence strength

`lib/uncertainty.mjs`. Two separate signals, never merged for display
(PRINCIPLES 14):

- Faithfulness: classified cited passages divided by all cited
  passages. A completeness proxy for stance coverage, not an
  entailment check. A judge that mislabels a passage still scores 1.0.
- Evidence strength: a convex combination, `domains/3 x 0.4 + mean
  tier/3 x 0.3 + count/4 x 0.3`, each component in [0, 1], so the sum
  is in [0, 1]. The weights (0.4, 0.3, 0.3) are chosen, not fitted.

Verification: 20,000 random cited sets fuzzed through
`assessUncertainty`. No score left [0, 1]; observed maxima 1.0 and 0.97.
Labels (high at 0.7, moderate at 0.4) are display cut-offs, documented
as uncalibrated.

## 6. Split-conformal abstention

`lib/calibration.mjs`, after Tayebati et al. (arXiv:2502.06884). Fit:
take the labelled verdicts the system got right, compute nonconformity
`1 - calibrationScore` for each, and set the threshold at rank
`ceil((n+1)(1-alpha))` of the sorted scores. If that rank exceeds n, no
finite threshold exists at that alpha and the fit returns null rather
than fabricating one. `calibrationScore` is the conservative minimum of
the two uncertainty signals and exists only as this procedure's input.
It is not displayed as confidence anywhere.

Verification: Monte Carlo, 4,000 fitted thresholds per setting, fresh
correct samples drawn from the same distribution (reproduced with the
seeded generator in `tests/calibration.test.mjs`; the suite itself runs
a 600-trial seeded floor check per setting). Empirical keep-rates:
91.07% (n=30), 90.05% (n=50), 89.58% (n=100), 96.28% (n=50,
alpha=0.05), 90.20% (n=200), against a 90% (95%) target. The n=100
figure sits within one Monte Carlo standard error (about 0.5 points) of
target. The coverage statement assumes exchangeability between the
calibration set and future verdicts; a distribution shift voids it,
which is why advice ships only when a threshold was fitted on real
labelled output (`TRUTHLENS_CONFORMAL_Q` from `npm run eval`), and why
the fitted threshold is advisory, never a gate.

Hardening added in this round: alpha outside (0, 1) returns null
(previously `alpha=1.5` returned `undefined`), and non-finite sample
confidences are dropped before sorting, where NaN would have poisoned
the quantile ordering silently.

## 7. Verdict gates and roll-up

`lib/verdict.mjs`, `lib/pipeline.mjs`. These are logic, not statistics,
and are listed so nothing numeric hides among them:

- Corroboration: a decisive verdict needs cited passages from at least
  2 independent domains (counted as distinct `source` hostnames), or it
  downgrades to Partially supported. Domain counting treats two
  subdomains of one publisher as two domains only if their hostnames
  differ; that is a known coarseness, accepted and visible.
- Outdated: fires only when both sides have ISO dates
  (`extractPublishedDate` returns `YYYY-MM-DD` or null) and the newest
  contradicting date is strictly later than the newest supporting date.
  ISO dates sort correctly as strings; no other format is accepted.
- Compound roll-up: decisive requires every atomic element decisive and
  in agreement, and no Unverifiable element. Counting, not averaging.

## 8. Forensics number matching

`lib/forensics.mjs`. A claimed number matches a passage number when
`|p - n| < 0.51` (rounding to the nearest whole or half unit) or the
relative difference is under 5%. The check is any-match over all number
pairs, which is lenient when many numbers are present: one matching
pair passes the check even if another number disagrees. Forensics
annotates; it never moves a verdict (PRINCIPLES 7), so the leniency is
recorded here rather than tightened blind.

## 9. Report arithmetic

`lib/report.mjs`. Coverage is `round(100 x investigated / total)`.
Investigated means a verdict was reached, `Unverifiable` included
(PRINCIPLES 12); `resolved` counts verdicts other than `Unverifiable`
and `Not fact-checkable`. Rounding is `Math.round`, half up, at most
half a percentage point of error, always displayed next to the raw
counts it came from.

## What is not claimed

- No score in this system is a probability of truth. The only
  probabilistic statement anywhere is the conformal keep-rate, and it
  covers "verdicts like the calibration set", not individual claims.
- Cosine similarity is not semantic understanding (section 1).
- Utility, priority, and evidence-strength weights are heuristics.
  Where a heuristic could change a verdict, the system was changed so
  it cannot (utility) or never could (priority, forensics).
