import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// One rendered surface, asserted together: the components first, then the page that composes them.
const page = ['../app/components/icons.js', '../app/components/mic.js', '../app/components/verdict.js', '../app/components/challenge.js', '../app/components/modal.js', '../app/components/personas.js', '../app/page.js'].map(read).join('\n');

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
  assert.ok(page.includes('Claims Found across all files'), 'library explains the claims count');
  assert.ok(page.includes('Claims Checked'), 'library says what remains unchecked');
});

test('reader words name evidence and verdicts accurately, without losing plain prose', () => {
  const layout = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  // Fetched passages are evidence, which can point either way. They are not conclusive proof.
  for (const marker of ['Find stronger evidence against it', 'Find evidence', 'We found no evidence that supports this claim.', 'We found no evidence that contradicts this claim.']) {
    assert.ok(page.includes(marker), marker);
  }
  const proofs = page.match(/proof/g) || [];
  const keptProofs = page.match(/not proof/g) || [];
  assert.equal(proofs.length, keptProofs.length, 'proof is kept only where conclusive proof is meant');
  assert.ok(page.includes('What would prove this wrong?'), 'prove stays for the falsifier question');
  // Verdict labels are named as verdicts where a verdict value or filter is shown.
  for (const marker of ['First verdict:', 'Latest verdict:', 'New verdict:', 'Verdicts so far:', 'Any verdict', 'Filter by verdict', 'How we reached this verdict']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.ok(page.includes('Question this answer'), 'plain prose keeps answer');
  // Stance comes from the text, and screened text carries instructions, not orders.
  assert.ok(page.includes("The author's position:"), 'author stance is named as a position');
  assert.ok(!page.includes('author thinks'), 'no mind-reading wording for author stance');
  assert.ok(page.includes('hidden instructions'), 'screened text is named as instructions');
  assert.ok(!page.includes('hidden orders'), 'no orders wording for screened text');
  assert.ok(!page.includes('good proof'), 'empty evidence states say what was not found');
  assert.ok(layout.includes('See the evidence behind each verdict.'), 'metadata uses the same words');
  assert.ok(!layout.includes('proof for each answer'), 'metadata does not call evidence proof');
});

test('verify request always clears the busy state and reports failures', () => {
  assert.match(page, /finally\s*{\s*setBusy\(''\)/);
  assert.match(page, /The check did not finish/);
});

test('main view is one investigate panel: mode switch, central upload, debate thread', () => {
  for (const marker of ['Check a claim', 'Check a book', 'data-upload', 'data-debate', 'Question this answer', 'Earlier in this conversation']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.equal(page.split('Ask a source anything').length - 1, 1, 'omnibar keeps exactly one ask entry point');
  assert.match(page, /setTool\('claim'\)/);
  assert.match(page, /setTool\('document'\)/);
  assert.ok(!page.includes("setTool('question')"), 'no duplicate question tool remains');
});

test('sign-in is hidden unless the deployment enables accounts', () => {
  assert.match(page, /authOn/, 'page tracks whether accounts are enabled');
  assert.match(page, /authOn &&/, 'sign-in UI renders only when accounts are on');
});

test('main check view offers document theory investigation with an inline verdict', () => {
  const checkAt = page.indexOf('Check a claim');
  const assessAt = page.indexOf('data-assess-form');
  const libraryAt = page.indexOf('Workspace Library & Past Checks');
  assert.ok(assessAt > checkAt && assessAt < libraryAt, 'assess form lives on the main check view');
  assert.ok(page.includes('data-assess-inline'), 'assess verdict renders inline on the main view');
  assert.match(page, /Choose a document|Pick a document/, 'main view lets the reader pick the document');
});

test('document view offers reader-directed investigation controls', () => {
  for (const marker of ['Verify this claim', 'Not checked yet', 'Follow-up checks', 'Debate this claim in chat', 'Find stronger evidence against it', 'What would prove this wrong?', 'Pause auto-check', 'checked by you']) {
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
  assert.match(page, /setTool\('document'\)/, 'the link opens the ask tool');
  assert.match(page, /setTab\('check'\)/, 'the link returns to the main check view');
  assert.ok(!page.includes('Investigate a claim or theory from this book'), 'no duplicated investigate box in the library');
  assert.ok(!page.includes('Investigate a claim or theory from this page'), 'no duplicated investigate box for websites');
});

test('verdict view shows faithfulness and evidence strength separately', () => {
  assert.ok(page.includes('Citations with a clear side'));
  assert.ok(page.includes('Evidence strength'));
});

test('document view subscribes to live document events with polling kept as fallback', () => {
  assert.match(page, /EventSource/);
  assert.match(page, /\/events/);
  assert.match(page, /setInterval/);
});

test('website tool accepts a URL and library shows the source for website documents', () => {
  for (const marker of ['Inspect URL', 'data-website', '/api/documents/url', 'Website address']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /setTool\('website'\)/);
  assert.ok(!page.includes('<span>Check a website</span>'), 'no redundant website entry in the nav');
  assert.ok(page.includes('sourceUrl'), 'library keeps the website source link');
  assert.match(page, /kind === 'website'|kind !== 'book'|'website'/, 'library marks website documents');
});

test('asking about claims works for websites: picker labels them, verdict names the page', () => {
  assert.ok(page.includes('data-assess-form'), 'ask tool still covers books and websites');
  assert.match(page, /\(website\)|Website ·|kind === 'website' \?/, 'picker or cards label website sources');
  assert.ok(page.includes('On this page'), 'website verdict passages are named as page passages');
  assert.ok(page.includes('Ask this page a question'), 'website detail links to the ask tool for the page');
  assert.ok(page.includes('Web page'), 'website claim rows say web page instead of a book page');
});

test('past checks filter has no duplicate ask option', () => {
  assert.ok(page.includes('Filter by tool'), 'tool filter still exists');
  const filterAt = page.indexOf('Filter by tool');
  const filterSelect = page.slice(filterAt, page.indexOf('</select>', filterAt));
  assert.ok(!filterSelect.includes('Ask a source anything'), 'no ask option in the tool filter');
  assert.ok(!filterSelect.includes('value="question"'), 'no question workflow value in the filter');
  for (const marker of ['Any tool', 'Check a claim', 'Book', 'Website']) {
    assert.ok(page.includes(marker), marker);
  }
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
  assert.match(page, /30 to 60 seconds/);
});

test('upload offers image captioning and video transcription into the same pipeline', () => {
  assert.ok(page.includes('/api/documents/image'), 'image upload posts to the image route');
  assert.ok(page.includes('/api/documents/video'), 'video upload posts to the video route');
  assert.ok(page.includes('.png'), 'file picker accepts images');
  assert.ok(page.includes('.mp4'), 'file picker accepts videos');
  assert.ok(page.includes('Image · text by Muse Spark'), 'library labels image documents');
  assert.ok(page.includes('Video · text by Muse Voice'), 'library labels video documents');
});

test('verdict view shows the investigation stages that actually ran', () => {
  assert.ok(page.includes('data-trajectory'), 'trajectory anchor present');
  for (const label of ['Found and loaded sources', 'Read the sources and decided', 'Second check of the answer']) {
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

test('live stage rows show the model carried by the progress event', () => {
  assert.match(page, /s\.detail\.model/, 'live stage row renders detail.model for any stage that has one');
  assert.match(page, /detail\.counts/, 'live research row reads counts from the progress event');
});

test('claim tool takes many claims at once and runs them as a queue', () => {
  assert.ok(page.includes('one claim per line'), 'claim box says one claim per line');
  assert.ok(page.includes('data-claim-queue'), 'queue anchor present');
  assert.ok(page.includes('/api/verify/batch'), 'batch route is used');
  assert.match(page, /<textarea[^>]*value=\{claim\}/, 'claim box is multi-line');
});

test('history hub lists every workflow and reopens a full verdict', () => {
  for (const marker of ['data-history', '/api/history', 'Past checks', 'Search extracted claims or sources']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.ok(page.includes('Earlier in this conversation'), 'recent thread is still named');
});

test('typed claims survive a reload as a draft and finished verdicts reload from history', () => {
  assert.ok(page.includes('truthlens-claim-draft'), 'draft key present');
  assert.match(page, /localStorage/, 'draft uses browser storage as a typing aid only');
});

test('dictate for a claim is a mic icon inside the claim box, not a button below it', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(page.includes('input-with-mic'), 'claim box wrapper present');
  assert.ok(page.includes('mic-icon'), 'icon button class present');
  assert.ok(page.includes('<svg'), 'mic is drawn as an icon');
  assert.match(page, /variant="inline"/, 'claim dictation uses the inline variant');
  const boxAt = page.indexOf('input-with-mic');
  const micAt = page.indexOf('variant="inline"');
  const verifyAt = page.indexOf('Verify this claim');
  assert.ok(boxAt > -1 && micAt > boxAt && micAt < verifyAt, 'mic sits inside the claim box, above the verify button');
  assert.match(css, /\.input-with-mic\s*\{[^}]*position:\s*relative/, 'wrapper anchors the icon');
  assert.match(css, /\.mic-icon\s*\{[^}]*position:\s*absolute/, 'icon sits inside the box');
  assert.ok(!page.includes('<p><MicButton label="Dictate a claim"'), 'no separate dictate button under the claim box');
});

test('brand is the supplied logo and relevant components carry proper svg icons', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  assert.ok(page.includes('/truthlens-logo.png'), 'header uses the supplied logo file');
  assert.ok(page.includes('alt="TruthLens AI"'), 'logo keeps an accessible name');
  assert.ok(layout.includes('/truthlens-logo.png'), 'logo is the favicon too');
  for (const icon of ['claim', 'book', 'website', 'question', 'library', 'history', 'search', 'verify']) {
    assert.ok(page.includes(`<Icon name="${icon}"`), `Icon name="${icon}"`);
  }
  assert.ok(page.includes('data-icon={name}'), 'Icon renders data-icon from its name');
  assert.match(css, /\.brand-logo/, 'logo sizing is styled');
  assert.match(css, /\.icon/, 'icon sizing is styled');
});

test('history rows name how many similar checks were folded into them', () => {
  assert.ok(page.includes('duplicateCount'), 'history row reads the dedupe count');
  assert.ok(page.includes('similar checks'), 'history row names similar checks in plain words');
});

test('library stacks a dossier vault above the working detail', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(page.includes('data-vault-docs'), 'vault doc cards present');
  assert.ok(page.includes('data-vault-table'), 'vault claims table present');
  assert.match(css, /\.vault-cards\s*\{[^}]*grid/, 'cards sit in a grid');
  assert.match(css, /\.vault-table\s*\{/, 'claims table wrapper is styled');
  assert.match(css, /\.stat-cards\s*\{[^}]*grid/, 'stats sit in a ribbon grid');
});

test('vault source cards sit in a left side rail with its own vertical scroll', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const railAt = page.indexOf('vault-rail');
  const docsAt = page.indexOf('data-vault-docs');
  assert.ok(railAt > -1 && railAt < docsAt, 'cards anchor sits inside the side rail');
  assert.match(css, /\.vault-rail\s*\{[^}]*overflow-y:\s*auto/, 'rail scrolls vertically on its own');
  assert.match(css, /\.vault-rail\s*\{[^}]*position:\s*sticky/, 'rail stays put while the detail scrolls');
  assert.match(css, /\.vault-rail\s+\.vault-cards\s*\{[^}]*grid-template-columns:\s*1fr/, 'cards stack one per row inside the rail');
});

test('opening a document lands on its claims list', () => {
  assert.match(page, /setDoc\(d\); setSelected\(null\)/, 'document open clears any selected claim');
});

test('a source verdict opens on its own full-width claim page, not a squeezed side panel', () => {
  assert.ok(page.includes('data-claim-page'), 'claim page anchor present');
  assert.ok(page.includes('Back to claims'), 'claim page returns to the claims list');
  assert.ok(page.includes('Previous claim'), 'claim page can move to the previous claim');
  assert.ok(page.includes('Next claim'), 'claim page can move to the next claim');
  assert.ok(!page.includes('className="verdict-side"'), 'no verdict side panel remains');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.claim-page\s*\{/, 'claim page is styled');
});

test('the history store never poses as a library document', () => {
  assert.ok(page.includes("find((x) => x.kind !== 'history')"), 'default document skips the history store');
  assert.ok(page.includes('doc.kind !== \'history\''), 'document detail never renders the history store');
  assert.ok(page.includes("d.kind !== 'history'"), 'document cards skip the history store');
});

test('library and investigation history are dedicated views, not one page', () => {
  assert.ok(page.includes("tab === 'history'"), 'history has its own view state');
  assert.ok(page.includes("setTab('history')"), 'sidebar can open the history view');
  const libraryAt = page.indexOf("tab === 'library'");
  const historyAt = page.indexOf("tab === 'history'", libraryAt);
  const historyBlockAt = page.indexOf('data-history', libraryAt);
  assert.ok(libraryAt > -1 && historyAt > libraryAt, 'history view is its own branch after library');
  assert.ok(historyBlockAt > historyAt, 'history section lives inside the history view only');
  const libraryBlock = page.slice(libraryAt, historyAt);
  assert.ok(!libraryBlock.includes('data-history'), 'library view carries no history section');
  assert.ok(!libraryBlock.includes('Past checks'), 'library view carries no history heading');
});

test('there is no redundant check view, the sidebar is the navigation', () => {
  assert.ok(!page.includes('Check something'), 'no Check something view or label remains');
  assert.ok(page.includes("'nav-item on'"), 'sidebar uses designed nav items with an active state');
  assert.ok(page.includes('nav-badge'), 'library carries a count badge');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.nav-item\s*\{/, 'nav item styling present');
  assert.match(css, /\.nav-item\.on\s*\{[^}]*background/, 'active item carries the green pill');
  assert.ok(!css.includes('#e9f2ef'), 'no pale pill background on nav items');
  assert.match(css, /\.content\s*\{[^}]*background:\s*var\(--surface\)/, 'content sits on the light surface');
});

test('navigation is a header at the top, not a left sidebar', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(page.includes('className="topnav"'), 'top header nav present');
  assert.ok(!page.includes('className="sidebar"'), 'no left sidebar remains');
  assert.ok(page.includes('className="content"'), 'content present');
  const navAt = page.indexOf('className="topnav"');
  const toolsAt = page.indexOf("setTool('claim')", navAt);
  const contentAt = page.indexOf('className="content"');
  assert.ok(navAt > -1 && toolsAt > navAt && toolsAt < contentAt, 'tools sit inside the top header, before the content');
  assert.match(css, /\.topnav\s*\{[^}]*position:\s*sticky/, 'header sticks at the top');
  assert.ok(!/\.layout\s*\{/.test(css), 'sidebar layout grid is gone');
});

test('dictate a theory is also a mic icon inside its box', () => {
  assert.ok(page.includes('Dictate a theory'), 'theory dictation still offered');
  assert.match(page, /<MicButton variant="inline" label="Dictate a theory"/, 'theory dictation uses the inline mic');
  assert.ok(!/<MicButton label="Dictate/.test(page), 'no labelled dictate button remains anywhere');
  assert.ok((page.match(/variant="inline"/g) || []).length >= 2, 'claim and theory both use the inline mic');
});

test('icons also live inside the book, website, question, and library panes', () => {
  for (const icon of ['upload', 'refresh', 'pause', 'play', 'back']) {
    assert.ok(page.includes(`<Icon name="${icon}"`), `Icon name="${icon}"`);
  }
  assert.ok((page.match(/<Icon name="verify"/g) || []).length >= 3, 'verify icon repeats on verify actions');
  assert.ok((page.match(/<Icon name="question"/g) || []).length >= 3, 'question icon repeats on ask actions');
  assert.ok((page.match(/<Icon name="book"/g) || []).length >= 2, 'book icon repeats inside the book pane');
  assert.ok((page.match(/<Icon name="website"/g) || []).length >= 2, 'website icon repeats inside the website pane');
  assert.ok((page.match(/<Icon name="search"/g) || []).length >= 2, 'search icon repeats on opposing-evidence actions');
});

test('logo sits on a transparent ground, not a black box', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const logoRule = css.match(/\.brand-logo\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(logoRule, 'brand logo rule present');
  assert.ok(!/background\s*:\s*#000/.test(logoRule), 'logo rule paints no black background');
  assert.ok(!/background\s*:\s*black/.test(logoRule), 'logo rule paints no black background');
});

test('library cards open the document in a popup viewer', () => {
  assert.ok(page.includes('data-document-viewer'), 'viewer popup anchor present');
  assert.ok(page.includes('role="dialog"'), 'viewer is a dialog');
  assert.ok(page.includes('aria-modal="true"'), 'viewer is modal');
  assert.ok(page.includes('View file'), 'cards offer View file');
  assert.match(page, /\/api\/documents\/\$\{/, 'viewer fetches the single-document payload');
  assert.ok(page.includes('contentPages'), 'viewer renders the document pages');
  assert.ok(page.includes('Page {p.page}'), 'viewer labels each page');
  assert.match(page, /Escape/, 'viewer closes on Escape');
});

test('document viewer is a reader of the document itself, not a second fact checker', () => {
  const viewerAt = page.indexOf('data-document-viewer');
  const deleteAt = page.indexOf('data-delete-confirm');
  assert.ok(viewerAt > -1 && deleteAt > viewerAt, 'viewer block located before the delete confirmation');
  const viewer = page.slice(viewerAt, deleteAt);
  assert.ok(viewer.includes('contentPages'), 'viewer renders the document pages');
  assert.ok(viewer.includes('Page {p.page}'), 'viewer shows the document page by page');
  assert.ok(!viewer.includes('Claims found in this document'), 'no claims list inside the reader');
  assert.ok(!viewer.includes('See claims and verdicts'), 'no fact-check shortcut inside the reader');
  assert.ok(!viewer.includes('cls(c.verdict)'), 'no verdict stamps inside the reader');
  assert.ok(!viewer.includes('Not yet verified'), 'no fact-check status inside the reader');
});

test('document viewer shows every supported type, not only extracted text', () => {
  const viewerAt = page.indexOf('data-document-viewer');
  const deleteAt = page.indexOf('data-delete-confirm');
  const viewer = page.slice(viewerAt, deleteAt);
  assert.ok(viewer.includes('/media'), 'viewer loads the stored original from the media endpoint');
  assert.match(viewer, /<img className="viewer-media"/, 'images render as images');
  assert.match(viewer, /<video className="viewer-media"[^>]*controls/, 'videos render in a player');
  assert.match(viewer, /<iframe className="viewer-frame"[^>]*application\/pdf|<iframe className="viewer-frame"/, 'pdfs render embedded');
  assert.ok(viewer.includes('viewerDoc.sourceUrl'), 'websites render framed from their source url');
  assert.ok(viewer.includes('Download the DOCX file'), 'types browsers cannot display (docx) offer the file');
  assert.ok(viewer.includes('media.file'), 'rendering keys off the stored original metadata');
  assert.ok(!viewer.includes('The image itself is not stored'), 'stored images no longer claim to be missing');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.viewer-media\s*\{[^}]*max-width:\s*100%/, 'media fits the viewer width');
  assert.match(css, /\.viewer-frame\s*\{[^}]*width:\s*100%/, 'embedded frames fill the viewer width');
});

test('a finished check opens a popup with the full verdict and extras in the library', () => {
  assert.ok(page.includes('data-result-popup'), 'result popup anchor present');
  assert.ok(page.includes('More options in the Library'), 'popup points to more options in the library');
  assert.match(page, /setResultPopup\(\{\s*result/, 'finishing a check opens the popup with the result');
  assert.ok(page.includes('data-library-focus'), 'the result can land in the library view');
  const popupAt = page.indexOf('data-result-popup');
  const popup = page.slice(popupAt, popupAt + 3000);
  assert.ok(popup.includes('<VerdictView'), 'popup renders the full verdict, evidence and all');
  const focusAt = page.indexOf('data-library-focus');
  const focus = page.slice(focusAt, focusAt + 1500);
  assert.ok(focus.includes('Check another claim'), 'library offers the next check as an extra option');
  assert.ok(focus.includes('Past checks'), 'library offers the saved history as an extra option');
});

test('challenge options push both ways: opposing and supporting', () => {
  for (const marker of ['Find stronger evidence against it', 'Find stronger evidence for it', 'What would prove this wrong?', 'What would confirm this?']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.ok(page.includes("onChallenge('stronger-support')"), 'supporting-evidence hunt is wired to a challenge kind');
  assert.ok(page.includes("onChallenge('prove-right')"), 'confirm-it hunt is wired to a challenge kind');
  assert.ok((page.match(/<ChallengeButtons/g) || []).length >= 1, 'assess debate keeps the shared challenge buttons'); assert.ok(page.includes('ChallengeDirections'), 'claims chat carries the full challenge set as directions');
  assert.ok(page.includes('What would prove it right:'), 'follow-up record can state what would confirm the claim');
  assert.ok(page.includes('confirmerFound'), 'follow-up record says whether confirming evidence was found');
});

test('library removes a document only after explicit typed confirmation', () => {
  assert.ok(page.includes('data-delete-confirm'), 'delete confirmation anchor present');
  assert.ok(page.includes('Remove file'), 'cards offer Remove file');
  assert.ok(page.includes('permanently removed'), 'confirmation states the removal is permanent');
  assert.match(page, /method:\s*'DELETE'/, 'removal calls the DELETE endpoint');
  assert.ok(page.includes('Type the file title'), 'confirmation requires typing the title');
  assert.match(page, /disabled=\{[^}]*confirmTitle/, 'confirm stays disabled until the title matches');
  assert.ok(!page.includes('window.confirm'), 'no one-click browser confirm');
});

test('popup and confirmation are styled as overlays above the page', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.modal-backdrop\s*\{[^}]*position:\s*fixed/, 'backdrop covers the page');
  assert.match(css, /\.modal\s*\{/, 'modal panel styled');
  assert.match(css, /\.doc-actions\s*\{/, 'card actions styled');
  assert.match(css, /\.btn\.danger/, 'destructive action styled');
});

test('challenge stage is labelled as a check, and single-run stability is worded honestly', () => {
  assert.ok(page.includes('Second check of the answer'), 'challenge stage label names a check');
  assert.ok(page.includes('No repeat run, so no agreement was measured'), 'single-run wording present');
});

test('redesign: dark Deep Intel theme with emerald verdict tokens', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--bg:\s*#090D16/, 'obsidian background token present');
  assert.match(css, /--teal:\s*#4edea3/, 'emerald accent token present');
  assert.match(css, /--researcher:\s*#06B6D4/, 'researcher cyan token present');
  assert.match(css, /--skeptic:\s*#F43F5E/, 'skeptic rose token present');
  assert.match(css, /body\s*\{[^}]*background:\s*var\(--bg\)/, 'body uses the dark background');
  assert.match(css, /prefers-reduced-motion/, 'reduced motion is respected');
});

test('redesign: live stages render as Researcher Fact-checker Skeptic agents from real events', () => {
  assert.ok(page.includes('data-agent-timeline'), 'agent timeline anchor present');
  for (const role of ['Researcher', 'Fact-checker', 'Skeptic']) assert.ok(page.includes(role), role);
  assert.match(page, /research.*Researcher|Researcher.*research/, 'research stage maps to Researcher');
  assert.match(page, /judge.*Fact-checker|Fact-checker.*judge/, 'judge stage maps to Fact-checker');
  assert.match(page, /challenge.*Skeptic|Skeptic.*challenge/, 'challenge stage maps to Skeptic');
  assert.ok(page.includes('liveStages'), 'timeline is fed by live stage events, not invented state');
});

test('redesign: verdict shows two uncertainty meters separately and no single truth score', () => {
  assert.ok(page.includes('data-uncertainty-meter'), 'uncertainty meter anchor present');
  assert.ok(page.includes('faithfulness.score'), 'faithfulness meter reads its real score');
  assert.ok(page.includes('evidenceStrength.score'), 'evidence strength meter reads its real score');
  assert.ok(!page.includes('Truth score'), 'no single truth score is invented');
  assert.ok(!page.includes('Confidence: '), 'no fabricated confidence percentage label');
});

test('redesign: supporting versus contradicting evidence shows real counts and clickable cards', () => {
  assert.ok(page.includes('data-evidence-balance'), 'evidence balance anchor present');
  assert.match(page, /supporting\.length/, 'supporting count comes from real evidence');
  assert.match(page, /contradicting\.length/, 'contradicting count comes from real evidence');
  assert.ok(page.includes('data-evidence-card'), 'evidence card anchor present');
  assert.match(page, /<a href=\{e\.url\}/, 'evidence card still links to its source');
});

test('redesign: demo claims are one-click and upload is a drop target', () => {
  assert.ok(page.includes('data-demo-claims'), 'demo claims anchor present');
  for (const claim of ['Water boils at 100 degrees Celsius at sea level.', 'Humans only use 10% of their brains.', 'Upper Snelgrove brewed exactly 41 barrels']) {
    assert.ok(page.includes(claim), claim);
  }
  assert.ok(page.includes('data-upload-drop'), 'upload drop target anchor present');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.dropzone\s*\{/, 'dropzone is styled');
});

test('redesign: dashboard stats and claim selection come from real document state', () => {
  assert.ok(page.includes('data-vault-stats'), 'vault stats anchor present');
  assert.ok(page.includes('data-claim-row'), 'claim row anchor present');
  assert.match(page, /report\?\.investigated|report\.investigated/, 'stats read the real document report');
});

test('redesign: home ticker mirrors the mockup KPI strip; the library vault owns the detailed totals', () => {
  assert.ok(page.includes('data-ticker'), 'home KPI ticker present');
  assert.ok(page.includes('Your work so far'), 'ticker heading on home');
  assert.ok(page.includes('Workspace Activity'), 'ticker kicker on home');
  assert.ok(page.includes('Inspect Claim'), 'ticker routes into a check');
  assert.ok(!page.includes('data-doc-breakdown'), 'no per-file breakdown on home');
  assert.ok(page.includes('data-vault-stats'), 'the library vault carries the totals');
});

test('home: Home is the default landing page with its own navigation item', () => {
  assert.match(page, /useState\('home'\)|\[tab, setTab\] = useState\('home'\)/, 'home is the initial tab');
  assert.ok(page.includes("setTab('home')"), 'navigation can open Home');
  assert.ok(page.includes('data-home'), 'home view anchor present');
  assert.match(page, />Home</, 'nav labels the home view');
});

test('home: hero and app summary live on Home, not on the Investigate page', () => {
  const homeAt = page.indexOf('data-home');
  const homeEnd = page.indexOf("{tab === 'check' && (");
  const homeBlock = page.slice(homeAt, homeEnd);
  assert.ok(homeAt > -1 && homeBlock.includes('data-home-check'), 'home view carries its own check panel');
  const checkAt = page.indexOf('<h2>Check</h2>');
  const checkBlock = page.slice(checkAt, homeEnd);
  assert.ok(!checkBlock.includes('data-home-check'), 'Investigate page carries no home check panel');
  assert.ok(page.includes('data-audience'), 'audience section anchor present');
  for (const who of ['researchers and journalists', 'before they publish', 'Truth seekers', 'lifelong learners', 'students', 'nonfiction readers']) {
    assert.ok(page.includes(who), who);
  }
  assert.ok(page.includes('data-how-it-works'), 'how it works anchor present');
  for (const step of ['Find claims', 'Find evidence', 'Strip prompts', 'Test both sides', 'Decide']) {
    assert.ok(page.includes(step), step);
  }
  assert.ok(page.includes('Unverifiable'), 'home names the honest abstention');
});

test('home: hero panel runs a check from the landing view', () => {
  assert.ok(page.includes('data-home-check'), 'home carries its own check panel');
  assert.ok(page.includes('LIVE EMPIRICAL PROTOCOL'), 'hero names the live protocol');
  assert.ok(page.includes('TRY ONE'), 'hero offers one-click claims');
  assert.ok(page.includes('Type Claim'), 'hero panel offers claim typing');
  assert.ok(page.includes('Attach File'), 'hero panel offers file attach');
  assert.ok(page.includes('Inspect URL'), 'hero panel offers URL inspect');
  assert.ok(page.includes('Verify'), 'hero panel verifies');
});

test('home: hero centers one check panel and names conspiracy theorists in the audience', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.home-hero\s*\{[^}]*text-align:\s*center/, 'hero centers its copy');
  assert.ok(page.includes('data-home-check'), 'hero check panel anchor present');
  assert.ok(!page.includes('data-hero-panel'), 'no side panel beside the hero');
  assert.match(page, /conspiracy theorists/i, 'audience names conspiracy theorists');
});

test('history: search, filters and refresh sit side by side on one line', () => {
  assert.ok(!page.includes('className="hist-controls"'), 'no separate controls row outside the card');
  assert.ok(!page.includes('Search history'), 'duplicate history search is gone');
  const histAt = page.indexOf('data-history');
  const barAt = page.indexOf('vault-table-bar', histAt);
  assert.ok(barAt > histAt, 'filter bar lives inside the history card');
  const block = page.slice(barAt, barAt + 3500);
  for (const marker of ['Search extracted claims or sources', 'Any verdict', 'Any tool', 'Reload']) assert.ok(block.includes(marker), marker);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.vault-table-bar\s*\{[^}]*display:\s*flex/, 'card bar sits in a flex row');
  assert.match(css, /\.vault-filters\s*\{[^}]*display:\s*flex/, 'search and selects share the card row');
});

test('upload offers docx extraction into the same pipeline', () => {
  assert.ok(page.includes('/api/documents/docx'), 'docx upload posts to the docx route');
  assert.ok(page.includes('.docx'), 'file picker accepts docx');
});

test('home makes multimodal support explicit: images, video, documents, websites', () => {
  assert.ok(page.includes('data-multimodal'), 'multimodal section anchor present');
  for (const marker of ['Muse Spark', 'Muse Voice Transcribe', 'PNG', 'MP4', 'DOCX', 'PDF']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /caption/i, 'image support is described as captioning');
  assert.match(page, /transcrib/i, 'video support is described as transcription');
});

test('multimodal cards sit on one line with a very large icon each', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.format-grid\s*\{[^}]*grid-template-columns:[^;]*repeat\(4/, 'four format cards share one row on desktop');
  assert.match(css, /\.format-icon \.icon\s*\{[^}]*width:\s*(3[2-9]|[4-9][0-9])px/, 'format icons are very large');
  for (const icon of ['book', 'website', 'image', 'video']) {
    assert.ok(page.includes(`data-format-icon="${icon}"`), `format icon ${icon}`);
  }
});

test('icons run through the whole site: section headings, audience, steps, formats', () => {
  // File, image, audio and video share one attach tab, so no pill carries a
  // literal video icon. The video icon still ships through the vault's
  // per-kind icon and the format card.
  for (const icon of ['users']) assert.ok(page.includes(`<Icon name="${icon}"`), `Icon ${icon} used`);
  assert.ok(page.includes('<Icon name={icon}'), 'vault renders the per-kind icon');
  assert.ok(page.includes("'video'"), 'video kind maps to its icon');
  assert.ok(page.includes('<span className="material-symbols-outlined">image</span>'), 'image tile uses the mockup material icon');
  assert.ok((page.match(/<Icon name=/g) || []).length >= 60, 'icons appear across nav, headings, cards and actions');
  assert.ok(page.includes('data-format-icon'), 'format cards carry icons');
});

test('audience section gives Students a full card beside Journalists and Researchers', () => {
  assert.ok(page.includes('data-audience-icon="students"'), 'students card icon present');
  assert.match(page, /<h3>Students<\/h3>/, 'students card heading present');
  const audAt = page.indexOf('data-audience');
  const block = page.slice(audAt, audAt + 4000);
  for (const who of ['Journalists', 'Researchers', 'Students']) assert.ok(block.includes(who), who);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.audience-grid\s*\{[^}]*repeat\(3/, 'three audience cards share the row');
});

test('home sections fill the width instead of leaving a narrow left column', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(page.includes('className="audience-top"'), 'audience top row anchor present');
  assert.match(css, /\.audience-top\s*\{[^}]*display:\s*grid/, 'audience intro and side note sit side by side');
  assert.match(css, /\.steps\s*\{[^}]*grid-template-columns:[^;]*repeat\(5/, 'how it works steps sit in five cards');
  assert.ok(!css.match(/\.home-body\{[^}]*max-width:\s*72ch/), 'audience copy is not trapped in a narrow column');
});

test('paste box says no page separator is needed', () => {
  assert.ok(!page.includes('Separate pages with --- page ---'), 'no separator instruction remains');
  assert.match(page, /Paste text here/, 'paste box invites pasting text');
});

test('header Claims view is a free claim chat investigator, not another results list', () => {
  assert.ok(page.includes("setTab('claims')"), 'navigation can open the Claims view');
  assert.ok(page.includes('data-claims-view'), 'claims view anchor present');
  assert.ok(page.includes('data-chat-thread'), 'chat thread anchor present');
  assert.ok(page.includes('data-chat-composer'), 'chat composer anchor present');
  assert.ok(page.includes('any claim'), 'chat invites any claim, not only existing ones');
  assert.ok((page.match(/readVerifyStream\(/g) || []).length >= 2, 'claim tool and chat share one streaming verifier');
  assert.ok(page.includes('/api/verify/stream'), 'the shared reader uses the stream route');
  assert.ok(page.includes('Start from an existing claim'), 'existing claims can seed the chat');
  const claimsAt = page.indexOf('data-claims-view');
  const claimsBlock = page.slice(claimsAt, page.indexOf("tab === 'history' &&", claimsAt));
  assert.ok(!claimsBlock.includes('Search claims'), 'claims view is not a search and filter list');
  assert.ok(!claimsBlock.includes('data-claim-row'), 'claims view does not repeat the history row list');
  assert.ok(claimsBlock.includes('data-chat-thread'), 'chat thread lives in the claims view');
});

test('claims chat shows its challenge options up front, each with a plain direction', () => {
  assert.ok(page.includes('data-challenge-options'), 'challenge options anchor present');
  const claimsAt = page.indexOf('data-claims-view');
  const block = page.slice(claimsAt, page.indexOf("tab === 'history' &&", claimsAt));
  for (const dir of ['best evidence against', 'best evidence for', 'would show the claim is wrong', 'would show the claim is right', 'what the author wrote']) {
    assert.ok(block.includes(dir) || page.includes(dir), dir);
  }
  assert.ok(block.indexOf('data-challenge-options') < block.indexOf('data-chat-composer'), 'challenge options appear before the composer, not buried under it');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.challenge-options\s*\{[^}]*display:\s*grid/, 'challenge options are a visible grid');
});

test('library is the record: download and challenge memory stay, live challenging moves to Debate a claim', () => {
  assert.ok(page.includes('data-challenge-record'), 'challenge record anchor present');
  assert.ok(page.includes('Debate this claim in chat'), 'library hands off to the chat investigator');
  assert.ok(page.includes('Download report'), 'report download remains on the record');
  const claimPageAt = page.indexOf('data-claim-page');
  const pageBlock = page.slice(claimPageAt, page.indexOf("tab === 'claims' &&", claimPageAt) > -1 ? page.indexOf("tab === 'claims' &&", claimPageAt) : claimPageAt + 6000);
  assert.ok(!pageBlock.includes('Or describe your own challenge'), 'library claim page carries no live challenge composer');
  assert.ok(page.includes('hideDownload'), 'chat verdicts can hide the duplicate download button');
});

test('claims chat suggests tailored next steps from the actual verdict', () => {
  assert.ok(page.includes('data-ai-guidance'), 'guidance anchor present');
  assert.ok(page.includes('Good next questions'), 'guidance is labelled per claim');
  assert.ok(page.includes('/api/claims/suggest'), 'suggestions are computed for the verdict by the suggester');
  assert.match(page, /evidenceStrength/, 'guidance reads real uncertainty fields');
});

test('claims chat does not duplicate the full verdict record, it shows a compact summary', () => {
  assert.ok(page.includes('data-verdict-summary'), 'compact verdict summary anchor present');
  assert.ok(page.includes('See the full result'), 'chat summary links back to the library record');
  const claimsAt = page.indexOf('data-claims-view');
  const block = page.slice(claimsAt, page.indexOf("tab === 'history' &&", claimsAt));
  assert.ok(!block.includes('<VerdictView'), 'chat thread does not re-render the full verdict panel');
  assert.ok(block.includes('data-verdict-summary') || page.includes('function VerdictSummary'), 'chat renders the compact summary instead');
  assert.match(page, /hasEvidence/, 'record view hides the empty evidence columns when nothing was cited');
});

test('claims chat suggestions come from the AI suggester endpoint, not fixed rules', () => {
  assert.ok(page.includes('/api/claims/suggest'), 'chat asks the suggester endpoint');
  assert.ok(page.includes('investigateAs'), 'clicking a suggestion investigates its checkable statement');
  assert.ok(!page.includes('suggestionsFor'), 'fixed rule-based picker is gone');
  assert.ok(page.includes('Muse Spark wrote these'), 'AI provenance is labelled');
  assert.ok(page.includes('Live AI is off'), 'paused-AI fallback is labelled honestly');
});

test('library document actions are sectioned and aligned, not loose button rows', () => {
  assert.ok(page.includes('data-doc-actions'), 'document actions panel anchor present');
  for (const label of ['Verification', 'Ask about this file']) assert.ok(page.includes(label), label);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.action-cards\s*\{[^}]*display:\s*grid/, 'actions sit in an aligned card grid');
  assert.match(css, /\.action-card\s*\{/, 'each action is a card with its own description');
});

test('document panel has no duplicate View or Remove actions and its Ask box carries text into the tool', () => {
  const panelAt = page.indexOf('data-doc-actions');
  const panel = page.slice(panelAt, panelAt + 4000);
  assert.ok(!panel.includes('View file'), 'panel does not repeat View file');
  assert.ok(!panel.includes('Remove file'), 'panel does not repeat Remove file');
  assert.ok(panel.includes('Ask this book a question') || panel.includes('Ask this page a question'), 'ask action remains in the panel');
  assert.ok((page.match(/value=\{theory\}/g) || []).length >= 2, 'panel input and tool textarea share the theory state, so text carries over');
  assert.ok(panel.includes('value={theory}'), 'panel ask input is bound to the shared theory state');
});

test('document list card keeps View and Remove on one line', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.doc-actions\s*\{[^}]*flex-wrap:\s*nowrap/, 'card actions never wrap');
  assert.match(css, /\.doc-actions \.btn\s*\{[^}]*white-space:\s*nowrap/, 'each card action stays on one line');
});

test('document ask input offers dictation into the shared theory text', () => {
  const at = page.indexOf('id="doc-ask-input"');
  assert.ok(at > -1, 'document ask input present');
  const around = page.slice(Math.max(0, at - 200), at + 900);
  assert.ok(around.includes('input-with-mic'), 'ask input sits in the microphone wrapper');
  assert.match(around, /<MicButton variant="inline"[^>]*onText=/, 'inline microphone feeds the ask input');
});

test('header: Debate a claim sits in the Investigate group and the nav fits on one line', () => {
  assert.ok(page.includes('Debate a claim'), 'claims chat is named Debate a claim');
  const debateAt = page.indexOf('Debate a claim');
  const libraryNavAt = page.indexOf('<span>Workspace Library</span>');
  assert.ok(debateAt > -1 && debateAt < libraryNavAt, 'Debate sits with the Investigate tools, before the Workspace group');
  assert.ok(page.includes("setTab('claims')"), 'Debate still opens the claims chat view');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.topnav-in\s*\{[^}]*flex-wrap:\s*nowrap/, 'header never wraps onto a second line');
  assert.match(css, /\.topnav-in\s*\{[^}]*overflow-x:\s*auto/, 'header scrolls sideways on narrow screens instead of overflowing');
});

test('upload is a modern drag-and-drop zone, not a native file button', () => {
  assert.ok(page.includes('onDrop'), 'files can be dropped onto the zone');
  assert.ok(page.includes('Drag & drop your file here') || page.includes('Drag and drop your file here'), 'drop instruction leads the zone');
  assert.ok(page.includes('Browse files'), 'styled browse action present');
  assert.ok(page.includes('className="file-hidden"'), 'native file input is hidden behind the zone');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.dropzone\.dragging\s*\{/, 'drag-over state is styled');
  assert.match(css, /\.file-hidden\s*\{[^}]*opacity:\s*0/, 'native input is visually hidden');
});

test('header uses the full width and compacts before anything is cut off', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('@media(max-width:1500px){.topnav-in{font-size:12px'), 'nav compacts before items clip');
});

test('mast, nav and content share one wide centered page container', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--page-max:\s*1440px/, 'page max width follows the 12-column grid');
  assert.match(css, /\.wrap\s*\{[^}]*width:\s*100%[^}]*max-width:\s*var\(--page-max\)[^}]*margin:\s*0 auto/, 'content fills the shared container and is centered');
  assert.match(css, /\.topnav-in\s*\{[^}]*width:\s*100%[^}]*max-width:\s*var\(--page-max\)[^}]*margin:\s*0 auto/, 'nav uses the same container as the content, not a different full width');
  assert.match(css, /\.topnav-in\s*\{[^}]*justify-content:\s*safe center/, 'nav items sit centered instead of stranding whitespace on the right');
  assert.match(css, /\.mast\s*\{[^}]*\(100% - var\(--page-max\)\)/, 'mast content aligns to the same container edges');
  assert.ok(!/\.wrap\s*\{[^}]*max-width:\s*1440px/.test(css), 'old narrow 1440px content column is gone');
  assert.ok(!/\.topnav-in\s*\{[^}]*max-width:\s*none/.test(css), 'nav no longer breaks out of the shared container');
});

test('plain English: hard jargon and trial metaphors stay off the website', () => {
  for (const hard of ['Cross-examine', 'Put a claim on trial', 'Citation stance coverage', 'Atomic elements', 'Falsifier:', 'Confirmer:', 'Evidence Forensics', 'proposition by proposition', 'Investigation history']) {
    assert.ok(!page.includes(hard), hard);
  }
  for (const plain of ['Check a claim', 'Check a book', 'Inspect URL', 'Past checks', 'Evidence for the claim', 'Evidence against the claim', 'What would prove it wrong:']) {
    assert.ok(page.includes(plain), plain);
  }
});

test('switching accounts clears the previous account workspace', () => {
  const authStart = page.indexOf('async function auth(');
  const authEnd = page.indexOf('async function verify()');
  const authBody = page.slice(authStart, authEnd);
  for (const reset of ['setDoc(null)', 'setSelected(null)', 'setChatMessages([])', 'setChatContext(null)', "setAssessDocId('')", 'setResultPopup(null)']) {
    assert.ok(authBody.includes(reset), `sign-in/sign-out must clear ${reset}`);
  }
});

test('batch queue shows only the first claim as running', () => {
  assert.ok(page.includes("state: i === 0 ? 'running' : 'waiting'"), 'queued claims wait their turn');
  assert.ok(!page.includes("lines.map((text) => ({ text, state: 'running' }))"), 'not every claim is marked running at once');
});

test('batch partial failure keeps the failed claim text in the box', () => {
  assert.ok(page.includes('failed.map((x) => x.text).join'), 'failed claims go back into the claim box');
});

test('batch claims past the limit go back into the box with an explanation', () => {
  assert.ok(page.includes('d.dropped'), 'the page reads the dropped claims the batch route names');
  assert.ok(page.includes('Only the first'), 'the page says plainly that only part of the batch was checked');
});

test('single check clears the claim box like a finished batch does', () => {
  const singleStart = page.indexOf('const applyResult = (d) => {');
  const single = page.slice(singleStart, singleStart + 500);
  assert.ok(single.includes("setClaim('')"), 'single verdict clears the claim box');
});

test('empty paste is refused on the page, not only by the server', () => {
  const start = page.indexOf('async function addDoc()');
  const addDoc = page.slice(start, start + 400);
  assert.ok(addDoc.includes('Paste document text first.'), 'empty paste shows a hint before the request');
});

test('oversize uploads are refused before the request is sent', () => {
  assert.ok(page.includes('uploadSizeError(file)'), 'upload checks the file size up front');
});

test('deleting a file clears assess and chat pointers to it', () => {
  const start = page.indexOf('async function removeDocument()');
  const remove = page.slice(start, start + 900);
  assert.ok(remove.includes("if (assessDocId === removedId) setAssessDocId('')"), 'assess selector drops the deleted file');
  assert.ok(remove.includes('chatContext?.docId === removedId'), 'chat context drops the deleted file');
});

test('assess refuses a target that no longer exists', () => {
  assert.ok(page.includes('const target = realDocs.find((x) => x.id === '), 'assess resolves the target against live documents');
});

test('assess follow-ups challenge the claim that was checked', () => {
  assert.ok(page.includes('challenge(kind, assessTarget)'), 'inline follow-ups name the assessed claim');
});

test('unresolvable chat record is not shown under another file', () => {
  assert.ok(page.includes('That result is no longer in your Library.'), 'missing record says so instead of borrowing another title');
  assert.ok(!page.includes('else if (result) setSelected(result);'), 'no fallback pairing with the open document');
});

test('mic releases the stream when the button unmounts', () => {
  const micStart = page.indexOf('export function MicButton');
  const mic = page.slice(micStart, micStart + 1200);
  assert.ok(mic.includes('getTracks().forEach') && mic.includes('useEffect(() => () =>'), 'unmount cleanup stops the mic tracks');
});

test('challenge directions wait while any check is busy', () => {
  assert.ok(page.includes("disabled={!ready || !!busy}"), 'five-way buttons disable during chat and challenge work');
});

test('report download link enters the document before it is clicked', () => {
  assert.ok(page.includes('document.body.appendChild(a)'), 'download anchor is attached so Firefox follows it');
});

test('viewer names the text section for pasted files too', () => {
  assert.ok(!page.includes("(viewerDoc.media?.file || viewerDoc.kind === 'website') && !viewerBusy && viewerDoc.contentPages?.length > 0"), 'heading is not limited to stored files and websites');
});

test('delete confirmation compares trimmed titles', () => {
  assert.ok(page.includes('confirmTitle.trim() !== pendingDelete.title.trim()'), 'both sides of the exact-title check are trimmed');
});

test('home mirrors the design mockup sections and copy', () => {
  for (const marker of ['LIVE EMPIRICAL PROTOCOL', 'Do not just read it. Check it.', 'Type Claim', 'Attach File', 'Inspect URL', 'TRY ONE', 'Architecture of Integrity', 'We never collapse complex evidence into a single reductive truth percentage.', 'Step-by-step uncompromised empirical verification procedure.', 'Who uses TruthLens', 'Same evidence for all', 'Workflow: Newsroom Pre-Pub', 'Workflow: Literature Review', 'Workflow: Academic Inquiry', 'Multimodal Ingestion', 'Documents & Books', 'Websites & URLs', 'Image OCR & Visuals', 'Audio & Video', 'Find claims', 'Strip prompts', 'New Verification', 'META API', 'material-symbols-outlined', '/mockup/img4.jpg', '/mockup/researchers.jpg', '/mockup/students.jpg', 'Workspace Activity', 'Inspect Claim']) {
    assert.ok(page.includes(marker), `mockup element present: ${marker}`);
  }
  assert.ok(!page.includes('data-workspace-hero'), 'workspace activity is gone from home');
  assert.ok(!page.includes('Triad Synced'), 'triad strip is gone');
});

test('agent triad chips carry their own colors, never one shared red', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  for (const marker of ['mock-triad', 'agent-r', 'agent-f', 'agent-s']) {
    assert.ok(page.includes(marker), `triad marker present: ${marker}`);
  }
  assert.match(css, /\.mock-triad \.agent-r\s*\{[^}]*var\(--researcher\)/, 'researcher chip is cyan');
  assert.match(css, /\.mock-triad \.agent-f\s*\{[^}]*var\(--factchecker\)/, 'fact-checker chip is green');
  assert.match(css, /\.mock-triad \.agent-s\s*\{[^}]*var\(--skeptic\)/, 'skeptic chip is rose, not shared red');
});

test('header mirrors the command bar: brand, Meta pill, nav, New Verification', () => {
  assert.ok(page.includes('META API'), 'header names the Meta API state');
  assert.ok(page.includes('New Verification'), 'header offers a new verification');
  assert.ok(page.includes('<span>Workspace Library</span>'), 'nav names the workspace library');
});

test('verdict view reads as an audit dossier with matrix, agents and ledger', () => {
  for (const marker of ['data-dossier', 'data-adjudication', 'data-dossier-metrics', 'data-evidence-matrix', 'data-agent-deliberation', 'data-ledger']) {
    assert.ok(page.includes(marker), `dossier anchor present: ${marker}`);
  }
});

test('library reads as a vault with stats, doc cards and a claims table', () => {
  for (const marker of ['data-vault-stats', 'data-vault-docs', 'data-vault-table']) {
    assert.ok(page.includes(marker), `vault anchor present: ${marker}`);
  }
});

test('library reads as a dossier vault: header, stats, cards, claims feed', () => {
  for (const marker of ['data-vault', 'CORPUS DOSSIER VAULT', 'Workspace Library & Past Checks', 'Upload New Source', 'Run Batch Verification', 'Indexed Corpus', 'Claims Extracted', 'Adjudication Rate', 'Forensic Reports', 'Engine Sync', 'Source Ingestions', 'Most Recent', 'Search extracted claims or sources', 'Extracted Claim Statement', 'Citation Alignment', 'Evidence Strength']) {
    assert.ok(page.includes(marker), `vault marker present: ${marker}`);
  }
  assert.ok(!page.includes('Triple Adversarial Consensus Model'), 'triad consensus section is removed');
  assert.ok(!page.includes('Three Checks of the Same Evidence. No Ambiguity.'), 'triad heading is removed');
  assert.ok(page.includes('Books & Manuscripts') || page.includes('Books &amp; Manuscripts'), 'vault tabs name books');
  assert.ok(page.includes('Media & Scans') || page.includes('Media &amp; Scans'), 'vault tabs name scans');
});

test('past checks holds the claims table with clickable rows', () => {
  assert.ok(page.includes('data-history-table'), 'history claims table present');
  const histAt = page.indexOf('data-history');
  const tableAt = page.indexOf('data-history-table');
  assert.ok(tableAt > histAt, 'claims table lives in the history tab');
  const block = page.slice(tableAt, tableAt + 4000);
  assert.ok(block.includes('reopenHistory'), 'table rows open their verdict');
});

test('claims table exists once: no duplicate vault table in the library', () => {
  const hits = page.match(/data-vault-table/g) || [];
  assert.equal(hits.length, 1, 'exactly one vault table in the page');
});

test('debate chat reads as a transcript with an interrogation console', () => {
  for (const marker of ['data-transcript', 'data-interrogation']) {
    assert.ok(page.includes(marker), `transcript anchor present: ${marker}`);
  }
});

test('what we found so far sits on top, before verification actions and claims', () => {
  const summaryAt = page.indexOf('What we found so far');
  const panelAt = page.indexOf('data-doc-actions');
  const claimsAt = page.indexOf('data-claim-row');
  assert.ok(summaryAt > -1 && panelAt > -1, 'summary and verification panel both present');
  assert.ok(summaryAt < panelAt, 'summary renders before the verification actions');
  assert.ok(claimsAt === -1 || summaryAt < claimsAt, 'summary renders before the claim rows');
});

test('vault source cards scroll vertically and open on card click', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.vault-cards\s*\{[^}]*overflow-y:\s*auto/, 'cards grid scrolls vertically for many sources');
  assert.match(css, /\.vault-cards\s*\{[^}]*max-height/, 'cards grid caps height so many sources scroll inside it');
  assert.match(css, /\.vault-card[^}]*cursor:\s*pointer/, 'cards look clickable');
  assert.match(page, /<article[^>]*vault-card[^>]*onClick/, 'whole card opens on click, not just the title');
});
