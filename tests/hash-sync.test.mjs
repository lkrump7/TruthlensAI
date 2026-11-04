import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('tabs start from the pasted hash so sync never clobbers a deep link', () => {
  assert.ok(page.includes("parseHash(window.location.hash)?.tab) || 'home'"), 'tab starts from the hash');
  assert.ok(page.includes("parseHash(window.location.hash)?.tool) || 'claim'"), 'tool starts from the hash');
});

test('a pasted non-library route never parks the hash sync', () => {
  const at = page.indexOf('const route = parseHash(window.location.hash);');
  assert.ok(at > -1, 'mount route effect exists');
  const block = page.slice(at, at + 800);
  assert.ok(block.includes("route.tab === 'library' && route.docId"), 'only a pending library doc link parks');
  assert.ok(!block.includes('{ routeRef.current = route; setTab(route.tab);'), 'parking no longer rides along unconditionally');
});
