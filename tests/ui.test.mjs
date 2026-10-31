import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('verify result renders inline under the verify form, not only at the page bottom', () => {
  const formAt = page.indexOf('Verify this claim');
  const inlineAt = page.indexOf('data-result-inline');
  assert.ok(inlineAt > formAt, 'inline result anchor must follow the verify form');
});

test('main check view is actions only; document stats live in the library tab in plain words', () => {
  assert.match(page, /setTab\('check'\)/, 'a Check tab is the default view');
  assert.match(page, /setTab\('library'\)/, 'a Library tab holds documents and results');
  assert.ok(!page.includes('evidence coverage'), 'no unexplained coverage jargon');
  assert.ok(!page.includes('chunks'), 'no unexplained chunk counts');
  assert.ok(page.includes('claims found'), 'library explains the claims count');
  assert.ok(page.includes('still to check'), 'library says what remains unchecked');
});

test('verify request always clears the busy state and reports failures', () => {
  assert.match(page, /finally\s*{\s*setBusy\(''\)/);
  assert.match(page, /Verification did not complete/);
});

test('main view is one investigate panel: mode switch, central upload, debate thread', () => {
  for (const marker of ['Put a claim on trial', 'Cross-examine a book', 'Ask a source anything', 'data-upload', 'data-debate', 'Debate this verdict', 'Earlier in this conversation']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /setTool\('claim'\)/);
  assert.match(page, /setTool\('document'\)/);
  assert.match(page, /setTool\('question'\)/);
});

test('sign-in is hidden unless the deployment enables accounts', () => {
  assert.match(page, /authOn/, 'page tracks whether accounts are enabled');
  assert.match(page, /authOn &&/, 'sign-in UI renders only when accounts are on');
});

test('main check view offers document theory investigation with an inline verdict', () => {
  const checkAt = page.indexOf('Put a claim on trial');
  const assessAt = page.indexOf('data-assess-form');
  const libraryAt = page.indexOf('Your documents');
  assert.ok(assessAt > checkAt && assessAt < libraryAt, 'assess form lives on the main check view');
  assert.ok(page.includes('data-assess-inline'), 'assess verdict renders inline on the main view');
  assert.match(page, /Choose a document|Pick a document/, 'main view lets the reader pick the document');
});

test('document view offers reader-directed investigation controls', () => {
  for (const marker of ['Verify this claim', 'Not yet verified', 'Challenge this finding', 'Find stronger opposing evidence', 'What would prove this wrong?', 'Pause automatic verification', 'investigated by you']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /\/assess/);
  assert.match(page, /\/challenge/);
  assert.match(page, /\/auto/);
});

test('library has no second ask form, only a link to the main ask tool', () => {
  assert.equal(page.split('data-assess-form').length - 1, 1, 'exactly one ask form, on the main view');
  assert.equal(page.split('Dictate a theory').length - 1, 1, 'theory dictation exists once, on the main ask form');
  assert.ok(page.includes('data-ask-link'), 'library document view links to the ask tool instead of copying it');
  assert.match(page, /setAssessDocId\(doc\.id\)/, 'the link preselects the opened document');
  assert.match(page, /setTool\('question'\)/, 'the link opens the ask tool');
  assert.match(page, /setTab\('check'\)/, 'the link returns to the main check view');
  assert.ok(!page.includes('Investigate a claim or theory from this book'), 'no duplicated investigate box in the library');
  assert.ok(!page.includes('Investigate a claim or theory from this page'), 'no duplicated investigate box for websites');
});

test('verdict view shows faithfulness and evidence strength separately', () => {
  assert.ok(page.includes('Citation stance coverage'));
  assert.ok(page.includes('Evidence strength'));
});

test('document view subscribes to live document events with polling kept as fallback', () => {
  assert.match(page, /EventSource/);
  assert.match(page, /\/events/);
  assert.match(page, /setInterval/);
});

test('website tool accepts a URL and library shows the source for website documents', () => {
  for (const marker of ['Cross-examine a website', 'data-website', '/api/documents/url', 'Website address']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /setTool\('website'\)/);
  assert.ok(page.includes('sourceUrl'), 'library keeps the website source link');
  assert.match(page, /kind === 'website'|kind !== 'book'|'website'/, 'library marks website documents');
});

test('asking about claims works for websites: picker labels them, verdict names the page', () => {
  assert.ok(page.includes('Ask a source anything') || page.includes('Ask the book or website anything'), 'ask tool covers books and websites');
  assert.match(page, /\(website\)|Website ·|kind === 'website' \?/, 'picker or cards label website sources');
  assert.ok(page.includes('On this page'), 'website verdict passages are named as page passages');
  assert.ok(page.includes('Ask this page a question'), 'website detail links to the ask tool for the page');
  assert.ok(page.includes('Web page'), 'website claim rows say web page instead of a book page');
});

test('voice dictation offers a mic on claim and theory, encodes WAV, and never exposes the Meta key', () => {
  for (const marker of ['data-mic', 'Muse Voice Transcribe', '/api/transcribe', 'getUserMedia', 'AudioContext']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.ok(page.includes('encodeWav'), 'page encodes mono WAV for the transcribe endpoint');
  assert.ok(page.includes('24000') || page.includes('24_000'), 'page resamples to the model sample rate');
  assert.ok(!page.includes('META_MODEL_API_KEY'), 'browser never sees the Meta key');
  assert.match(page, /Listening|Release to fill/);
});

test('busy verify state tells the user live research takes a while', () => {
  assert.match(page, /30–60 seconds|30-60 seconds/);
});

test('upload offers image captioning and video transcription into the same pipeline', () => {
  assert.ok(page.includes('/api/documents/image'), 'image upload posts to the image route');
  assert.ok(page.includes('/api/documents/video'), 'video upload posts to the video route');
  assert.ok(page.includes('.png'), 'file picker accepts images');
  assert.ok(page.includes('.mp4'), 'file picker accepts videos');
  assert.ok(page.includes('Captioned image'), 'library labels image documents');
  assert.ok(page.includes('Transcribed video'), 'library labels video documents');
});

test('verdict view shows the investigation stages that actually ran', () => {
  assert.ok(page.includes('data-trajectory'), 'trajectory anchor present');
  for (const label of ['Searched and fetched sources', 'Judged the fetched passages', 'Skeptic check on the verdict']) {
    assert.ok(page.includes(label), label);
  }
});

test('verdict view shows stability in plain words', () => {
  assert.ok(page.includes('times on the same evidence'), 'stability line present');
  assert.ok(page.includes('Runs disagreed'), 'disagreement wording present');
});

test('verdict view offers a downloadable investigation report', () => {
  assert.ok(page.includes('Download report'), 'download button present');
  assert.ok(page.includes('/api/export'), 'export route is used');
});

test('claim check reads the stream and falls back plainly when it fails', () => {
  assert.ok(page.includes('/api/verify/stream'), 'stream route is used');
  assert.ok(page.includes('Live progress did not load'), 'fallback message present');
});

test('challenge stage is labelled as a check, and single-run stability is worded honestly', () => {
  assert.ok(page.includes('Skeptic check'), 'challenge stage label names a check');
  assert.ok(page.includes('No repeat run, so no agreement was measured'), 'single-run wording present');
});
