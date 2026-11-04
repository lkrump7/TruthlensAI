import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditVerdict } from '../lib/audit.mjs';

// Independent audit: deterministic checks over the final verdict, same rules
// for any claim. Audit notes never change the verdict; they add limitations.
test('audit flags an explanation that references no cited passage', () => {
  const notes = auditVerdict({
    text: 'Water boils at 100 degrees Celsius at sea level.',
    verdict: 'Supported', explanation: 'Trust me.',
    cited: [{ id: 'ev-1', passage: 'Water boils at 100 degrees Celsius at sea level.', url: 'https://a.example/x' }],
    supporting: [{ id: 'ev-1' }], contradicting: [], unclassified: [],
  });
  assert.ok(notes.some((n) => /no cited passage/i.test(n)));
});

test('audit flags a claim figure missing from every cited passage', () => {
  const notes = auditVerdict({
    text: 'The supplement increases intelligence by 40 percent in adults.',
    verdict: 'Supported', explanation: 'ev-1 shows gains.',
    cited: [{ id: 'ev-1', passage: 'The supplement increases intelligence in adults.', url: 'https://a.example/x' }],
    supporting: [{ id: 'ev-1' }], contradicting: [], unclassified: [],
  });
  assert.ok(notes.some((n) => /40/.test(n)));
});

test('audit flags a decisive verdict resting on a single passage', () => {
  const notes = auditVerdict({
    text: 'Apollo 11 landed on the Moon in 1969.',
    verdict: 'Supported', explanation: 'ev-1 records the landing.',
    cited: [{ id: 'ev-1', passage: 'Apollo 11 landed on the Moon in 1969.', url: 'https://a.example/x' }],
    supporting: [{ id: 'ev-1' }], contradicting: [], unclassified: [],
  });
  assert.ok(notes.some((n) => /single cited passage/i.test(n)));
});

test('audit stays silent on a clean two-passage verdict', () => {
  const notes = auditVerdict({
    text: 'Water boils at 100 degrees Celsius at sea level.',
    verdict: 'Supported', explanation: 'ev-1 and ev-2 both report boiling at 100 degrees.',
    cited: [
      { id: 'ev-1', passage: 'Water boils at 100 degrees Celsius at sea level.', url: 'https://a.example/x' },
      { id: 'ev-2', passage: 'Lab tables list water boiling at 100 degrees Celsius at sea level.', url: 'https://b.example/y' },
    ],
    supporting: [{ id: 'ev-1' }, { id: 'ev-2' }], contradicting: [], unclassified: [],
  });
  assert.deepEqual(notes, []);
});

test('assembleStage surfaces audit notes as limitations without changing the verdict', async () => {
  const { assembleStage } = await import('../lib/stages.mjs');
  const out = assembleStage('Water boils at 100 degrees Celsius at sea level.', {
    type: 'Scientific',
    gated: {
      verdict: 'Supported', supporting: [{ id: 'ev-1' }], contradicting: [], unclassified: [],
      limitations: [],
    },
    result: { explanation: 'Trust me.' }, judgedBy: 'Muse Spark 1.3',
    cited: [{ id: 'ev-1', passage: 'Water boils at 100 degrees Celsius at sea level.', url: 'https://a.example/x' }],
    stats: {},
  });
  assert.equal(out.verdict, 'Supported');
  assert.ok((out.limitations || []).some((l) => /no cited passage/i.test(l)));
});
