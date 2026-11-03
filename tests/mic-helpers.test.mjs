import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const micSrc = readFileSync(new URL('../app/components/mic.js', import.meta.url), 'utf8');
const challengeSrc = readFileSync(new URL('../app/components/challenge.js', import.meta.url), 'utf8');

// The helpers live in .js component files with JSX, which plain node cannot
// import. Evaluate the real pure-function source instead of copying it.
function evalFns(src, endMarker, names) {
  const end = src.indexOf(endMarker);
  assert.ok(end > -1, `source contains ${endMarker}`);
  const body = src
    .slice(0, end)
    .replace(/^import.*$/m, '')
    .replace(/export\s+function/g, 'function');
  return new Function(`${body}; return { ${names.join(', ')} };`)();
}

function evalRange(src, startMarker, endMarker, names) {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `source contains ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `source contains ${endMarker} after ${startMarker}`);
  const body = src.slice(start, end).replace(/export\s+function/g, 'function');
  return new Function(`${body}; return { ${names.join(', ')} };`)();
}

test('mic helpers are exported for testability', () => {
  assert.ok(micSrc.includes('export function resampleTo'), 'resampleTo is exported');
  assert.ok(micSrc.includes('export function encodeWav'), 'encodeWav is exported');
});

test('resampleTo averages each window instead of decimating', () => {
  const { resampleTo } = evalFns(micSrc, 'export function MicButton', ['resampleTo']);
  assert.deepEqual(Array.from(resampleTo(new Float32Array([2, 4, 6, 8]), 4, 2)), [3, 7]);
  assert.deepEqual(Array.from(resampleTo(new Float32Array([1, -1, 1, -1]), 4, 2)), [0, 0]);
});

test('resampleTo keeps the input when rates match', () => {
  const { resampleTo } = evalFns(micSrc, 'export function MicButton', ['resampleTo']);
  const samples = new Float32Array([0.5, -0.25, 0]);
  assert.equal(resampleTo(samples, 24000, 24000), samples);
});

test('encodeWav writes a sane WAV header', async () => {
  const { encodeWav } = evalFns(micSrc, 'export function MicButton', ['encodeWav']);
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 8000);
  const buf = Buffer.from(await wav.arrayBuffer());
  assert.equal(buf.length, 44 + 3 * 2);
  assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  assert.equal(buf.subarray(8, 12).toString(), 'WAVE');
  assert.equal(buf.subarray(36, 40).toString(), 'data');
  assert.equal(buf.readUInt32LE(24), 8000);
  assert.equal(buf.readUInt32LE(40), 3 * 2);
});

test('mic output stays silent to avoid speaker feedback', () => {
  assert.ok(micSrc.includes('createGain'), 'a GainNode sits in the monitor path');
  assert.match(micSrc, /gain\.value\s*=\s*0/, 'the GainNode is zero-gain');
  assert.ok(!micSrc.includes('processor.connect(ctx.destination)'), 'no direct processor-to-speaker route');
});

test('mic start guards on the live recording ref', () => {
  assert.ok(micSrc.includes('if (rec.current) return'), 're-entry guard reads rec.current');
});

test('hold-to-talk captures the pointer so release outside still stops', () => {
  assert.ok(micSrc.includes('setPointerCapture'), 'pointerdown captures the pointer');
  assert.ok(micSrc.includes('onPointerLeave'), 'pointerleave stays as backup');
});

test('challenge exposes a pure suggestKey', () => {
  assert.ok(challengeSrc.includes('function suggestKey'), 'suggestKey exists');
  assert.ok(challengeSrc.includes('suggestKey(r)'), 'SuggestedNext uses suggestKey');
});

test('suggestKey is sensitive to evidence and research counts', () => {
  const { suggestKey } = evalRange(challengeSrc, 'function suggestKey', 'export function SuggestedNext', ['suggestKey']);
  const base = {
    text: 'Water boils at 100C',
    verdict: 'Supported',
    followups: [],
    supporting: [{ id: 'a' }],
    contradicting: [],
    unclassified: [],
    research: { fetched: 3, sourcesFound: 5 },
  };
  const key = suggestKey(base);
  assert.ok(key.length > 0, 'non-empty key for a verdict');
  assert.equal(suggestKey(structuredClone(base)), key, 'same record, same key');
  assert.equal(suggestKey(null), '', 'null record has an empty key');
  const variants = [
    ['text', { ...base, text: 'Water boils at 90C' }],
    ['verdict', { ...base, verdict: 'Contradicted' }],
    ['followups', { ...base, followups: [{ kind: 'x' }] }],
    ['supporting', { ...base, supporting: [{ id: 'a' }, { id: 'b' }] }],
    ['contradicting', { ...base, contradicting: [{ id: 'c' }] }],
    ['unclassified', { ...base, unclassified: [{ id: 'u' }] }],
    ['fetched', { ...base, research: { fetched: 4, sourcesFound: 5 } }],
    ['sourcesFound', { ...base, research: { fetched: 3, sourcesFound: 6 } }],
  ];
  for (const [name, v] of variants) {
    assert.notEqual(suggestKey(v), key, `key changes when ${name} changes`);
  }
});
