import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessUncertainty } from '../lib/uncertainty.mjs';

const ev = (id, source, stance) => ({ id, source, stance, passage: 'p' });

test('faithfulness and evidence strength are reported separately', () => {
  const strong = assessUncertainty({
    cited: [ev('a', 'nih.gov', 'supports'), ev('b', 'nasa.gov', 'supports')],
    supporting: [ev('a', 'nih.gov', 'supports'), ev('b', 'nasa.gov', 'supports')], contradicting: [], unclassified: [],
  });
  assert.equal(strong.faithfulness.label, 'high');
  assert.equal(strong.evidenceStrength.label, 'high');
});

test('a verdict can be faithful to weak evidence — the split shows it', () => {
  const weak = assessUncertainty({
    cited: [ev('a', 'blog.example', 'supports')],
    supporting: [ev('a', 'blog.example', 'supports')], contradicting: [], unclassified: [],
  });
  assert.equal(weak.faithfulness.label, 'high');
  assert.equal(weak.evidenceStrength.label, 'low');
});

test('unclassified citations lower faithfulness even from strong sources', () => {
  const unfaithful = assessUncertainty({
    cited: [ev('a', 'nih.gov', 'unknown'), ev('b', 'who.int', 'unknown')],
    supporting: [], contradicting: [], unclassified: [ev('a', 'nih.gov', 'unknown'), ev('b', 'who.int', 'unknown')],
  });
  assert.equal(unfaithful.faithfulness.score, 0);
  assert.equal(unfaithful.faithfulness.label, 'low');
  assert.ok(unfaithful.evidenceStrength.score > unfaithful.faithfulness.score);
});

test('no citations means no faithfulness and no strength', () => {
  const none = assessUncertainty({ cited: [], supporting: [], contradicting: [], unclassified: [] });
  assert.equal(none.faithfulness.score, 0);
  assert.equal(none.evidenceStrength.score, 0);
});
