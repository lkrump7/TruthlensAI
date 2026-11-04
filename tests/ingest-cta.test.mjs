import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const dossier = read('../app/components/excerpt-dossier.js');
const page = read('../app/page.js');
const css = read('../app/globals.css');

test('dead Split Reader Mode toggle is gone from the dossier', () => {
  assert.ok(!dossier.includes('Split Reader Mode'), 'no Split Reader Mode button text');
  assert.ok(!dossier.includes('splitReader'), 'no splitReader prop');
  assert.ok(!dossier.includes('onToggleSplit'), 'no onToggleSplit prop');
  assert.ok(!dossier.includes('data-split-reader'), 'no dead split-reader panel');
});

test('Check-a-excerpt tab keeps one persistent Ingest entry point on top', () => {
  assert.ok(page.includes("tool === 'document'"), 'document tool branch exists');
  assert.ok(page.includes('data-ingest-topbar'), 'persistent ingest topbar in Check-a-excerpt tab');
  assert.ok(page.includes('Ingest New Manuscript'), 'topbar labels the ingest action');
  assert.ok(page.includes('ingest-hero'), 'ingest button uses the hero size class');
  const bar = page.indexOf('data-ingest-topbar');
  const dossierAt = page.indexOf('<ExcerptDossier');
  assert.ok(bar > -1 && dossierAt > bar, 'topbar renders above the dossier');
});

test('Ingest hero is styled big and clearly visible', () => {
  assert.ok(css.includes('.doc-ingest-bar'), 'topbar style exists');
  assert.ok(css.includes('.ingest-hero'), 'hero button style exists');
});
