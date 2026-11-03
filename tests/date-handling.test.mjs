import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestigationReport } from '../lib/export.mjs';
import { inTextDate } from '../lib/nlp.mjs';

const BASE = {
  text: 'A claim.',
  verdict: 'Supported',
  judgedBy: 'Muse Spark 1.3',
  mode: 'live',
  explanation: 'e',
  supporting: [],
  contradicting: [],
  limitations: ['l'],
};

test('runDate rejects an impossible YYYY-MM-DD prefix instead of printing it', () => {
  const md = buildInvestigationReport(
    { ...BASE, history: [{ at: '2024-13-99 nonsense' }] },
    { now: new Date('2026-10-31T00:00:00Z') },
  );
  assert.match(md, /^Run: not recorded$/m);
});

test('inTextDate reads a pre-1900 month-year as ISO', () => {
  assert.equal(inTextDate('The Origin of Species was published in June 1859.'), '1859-06-01');
});
