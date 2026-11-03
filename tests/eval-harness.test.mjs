import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { extractDemoArc, parseTrials } = await import('../lib/eval-harness.mjs');

test('demo-arc extraction still reads the live gate fixture', () => {
  const source = readFileSync(new URL('./demo-arc.test.mjs', import.meta.url), 'utf8');
  const arc = extractDemoArc(source);
  assert.ok(arc, 'the real demo fixture extracts cleanly');
  assert.equal(arc.claims.length, 3);
  assert.equal(arc.expected.length, 3);
  assert.ok(arc.claims[0].includes('Water boils'), `first claim is the water claim, got ${arc.claims[0]}`);
});

test('demo-arc extraction survives a claim with an apostrophe', () => {
  const source = `
    text: "The mayor's office confirmed the reservoir reading.",
    assert.equal(r.verdict, 'Supported')
    text: "The clerk's ledger lists 41 barrels.",
    assert.equal(r.verdict, 'Unverifiable')
    text: "The surveyor's map shows the old dam.",
    assert.equal(r.verdict, 'Supported')
  `;
  const arc = extractDemoArc(source);
  assert.ok(arc, 'double-quoted claims extract instead of failing closed');
  assert.equal(arc.claims[0], "The mayor's office confirmed the reservoir reading.");
  assert.deepEqual(arc.expected, ['Supported', 'Unverifiable', 'Supported']);
});

test('demo-arc extraction fails closed on unparseable sources', () => {
  assert.equal(extractDemoArc('no claims here'), null);
  assert.equal(extractDemoArc("text: 'only one claim here'"), null);
});

test('trial count parsing matches the eval runner forms', () => {
  assert.equal(parseTrials(['node', 'run.mjs', '--trials=5']), 5);
  assert.equal(parseTrials(['node', 'run.mjs', '--trials', '5']), 5);
  assert.equal(parseTrials(['node', 'run.mjs']), 3);
  // 0 is falsy so the runner falls back to the default, matching run.mjs.
  assert.equal(parseTrials(['node', 'run.mjs', '--trials', '0']), 3);
  assert.equal(parseTrials(['node', 'run.mjs', '--trials', 'abc']), 3);
  assert.equal(parseTrials(['node', 'run.mjs', '--trials', '-2']), 1);
});
