import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const appDir = new URL('../app/', import.meta.url);
function appSources(dir = appDir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) appSources(url, out);
    else if (entry.name.endsWith('.js')) out.push(readFileSync(url, 'utf8'));
  }
  return out;
}
const allApp = appSources().join('\n');
const dossierSrc = readFileSync(new URL('../app/components/excerpt-dossier.js', import.meta.url), 'utf8');

function loadDossierHelpers() {
  const start = dossierSrc.indexOf('// dossier-pure-helpers:start');
  const end = dossierSrc.indexOf('// dossier-pure-helpers:end');
  assert.ok(start !== -1 && end !== -1 && end > start);
  const block = dossierSrc.slice(start, end).split('\n')
    .filter((line) => !line.includes('dossier-pure-helpers:'))
    .map((line) => line.replace(/^export\s+/, '')).join('\n');
  return new Function(`${block}\nreturn { dossierEngineLabel, dossierKindLabel, dossierCheckingLabel };`)();
}

test('dossier engine label names the real judges, never Llama', () => {
  const { dossierEngineLabel } = loadDossierHelpers();
  assert.equal(dossierEngineLabel([]), 'Muse Spark 1.3, Muse Wonder 1.0 if needed');
  assert.equal(dossierEngineLabel([{ verdict: 'Supported', judgedBy: 'Muse Spark 1.3' }]), 'Muse Spark 1.3');
  assert.equal(dossierEngineLabel([
    { verdict: 'Supported', judgedBy: 'Muse Spark 1.3' },
    { verdict: 'Contradicted', judgedBy: 'Muse Wonder' },
  ]), 'Muse Spark 1.3, Muse Wonder');
  assert.equal(dossierEngineLabel([null, { verdict: null }]), 'Muse Spark 1.3, Muse Wonder 1.0 if needed');
});

test('dossier checking label reports what actually ran', () => {
  const { dossierCheckingLabel } = loadDossierHelpers();
  assert.equal(dossierCheckingLabel([]), 'Not checked yet');
  assert.equal(dossierCheckingLabel([{ verdict: 'Supported', judgedBy: 'Muse Spark 1.3' }]), 'Checked by Muse Spark');
  assert.equal(dossierCheckingLabel([{ verdict: 'Supported', judges: { agreed: true } }]), 'Spark and Wonder agreed');
  assert.equal(dossierCheckingLabel([{ verdict: 'Supported', judges: { agreed: false } }]), 'Spark and Wonder disagreed');
});

test('dossier kind label follows the document, not a fixed corpus claim', () => {
  const { dossierKindLabel } = loadDossierHelpers();
  assert.equal(dossierKindLabel({ kind: 'website' }), 'Website');
  assert.equal(dossierKindLabel({ kind: 'image' }), 'Image');
  assert.equal(dossierKindLabel({ kind: 'video' }), 'Video');
  assert.equal(dossierKindLabel({ kind: 'audio' }), 'Audio');
  assert.equal(dossierKindLabel({ kind: 'excerpt' }), 'Excerpt');
  assert.equal(dossierKindLabel({}), 'Document');
  assert.equal(dossierKindLabel({ media: { file: { mime: 'application/pdf' } } }), 'PDF');
  assert.equal(dossierKindLabel({ media: { file: { ext: 'docx' } } }), 'DOCX');
});

test('no app surface repeats the incorrect hardcoded labels', () => {
  const banned = [
    'Meta Llama 3.3', '70B', 'Tri-Agent', 'Tri-agent', 'tri-agent', 'Re-interrogate triad',
    'Zero ambiguity', '94%', 'A+', 'Auditable Proof',
    'cryptographically signed', 'cryptographically verified', 'Cryptographic Corpus Seal',
    'local encrypted workspace vault', 'Academic Corpus', 'Nonfiction Analysis',
    'Export Section Report (PDF)', 'full subdomains', 'chapter by chapter',
    'Three checks of the same evidence', 'three distinct autonomous checkers',
    'Synthetic Adjudication', 'Peer-reviewed empirical literature',
    'Muse Spark transcribes image claim text',
  ];
  for (const phrase of banned) {
    assert.ok(!allApp.includes(phrase), `incorrect label still present: ${phrase}`);
  }
  assert.ok(dossierSrc.includes('dossierEngineLabel(claims)'), 'dossier shows the derived engine label');
  assert.ok(dossierSrc.includes('Export Section Report (Markdown)'), 'report button names the real file type');
});
