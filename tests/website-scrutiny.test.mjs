import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrutinyTelemetry } from '../lib/website-scrutiny.mjs';

const doc = {
  title: 'The Energetics of Synaptic Plasticity',
  kind: 'website',
  sourceUrl: 'https://biotech-dispatch.org/reports/neuro-plasticity-metabolism',
  quarantined: 3,
  text: 'Metabolic budgeting in the central nervous system remains a cornerstone.\n\nSecond paragraph with more words here for counting.',
  claims: [
    { id: 'c1', text: 'glial silence claim', verdict: 'Contradicted' },
    { id: 'c2', text: 'metabolic rate claim', verdict: 'Supported' },
    { id: 'c3', text: 'ischemia claim', verdict: 'Partially supported' },
    { id: 'c4', text: 'unchecked claim', verdict: '' },
  ],
};

test('scrutinyTelemetry counts words, paragraphs and verdict tallies', () => {
  const t = scrutinyTelemetry(doc);
  assert.equal(t.words, 18);
  assert.equal(t.paragraphs, 2);
  assert.equal(t.total, 4);
  assert.equal(t.supported, 1);
  assert.equal(t.contradicted, 1);
  assert.equal(t.partial, 1);
  assert.equal(t.neutralized, 3);
  assert.equal(t.host, 'biotech-dispatch.org');
});

test('scrutinyTelemetry buckets Misleading and Outdated as partial like the dossier', () => {
  const t = scrutinyTelemetry({ claims: [
    { verdict: 'Misleading' }, { verdict: 'Outdated' }, { verdict: 'Partially supported' },
  ] });
  assert.equal(t.partial, 3);
});

test('website rail offers an unchecked filter and explains empty filter results', () => {
  const component = readFileSync(new URL('../app/components/website.js', import.meta.url), 'utf8');
  assert.ok(component.includes("'unchecked'") || component.includes('"unchecked"'), 'unchecked filter value present');
  assert.ok(component.includes('Not checked yet ('), 'unchecked filter shows a live count');
  assert.ok(component.includes('No claims match'), 'empty filter result is explained');
});

test('website docs render the Scrutiny workbench with real telemetry, not a generic card', () => {
  const component = readFileSync(new URL('../app/components/website.js', import.meta.url), 'utf8');
  for (const marker of ['Website Scrutiny', 'Extracted article DOM', 'Lexical scope', 'Assertion yield', 'Injection deflector', 'Inspect snippet', 'Save dossier', 'Send to Debate Arena']) {
    assert.ok(component.includes(marker), marker);
  }
  assert.ok(!component.includes('200 OK'), 'no fabricated crawl status');
  assert.ok(!component.includes('TLS 1.3'), 'no fabricated transport claim');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('--surface-lowest:#0a0e17') || css.includes('--surface-lowest: #0a0e17'), 'lowest well matches the sampled page ground');
  assert.match(css, /\.scr-card\{[^}]*background:var\(--surface\)/, 'telemetry cards use the sampled card navy');
  assert.match(css, /\.scr-claim\{[^}]*background:var\(--surface\)/, 'claim cards use the sampled card navy');
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.ok(page.includes('WebsiteScrutiny'), 'library wires the workbench for website docs');
});
