import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_STORAGE_KEY, resolveTheme, oppositeTheme } from '../lib/ui-state.mjs';

test('theme helpers default to dark and honor a stored choice', () => {
  assert.equal(THEME_STORAGE_KEY, 'truthlens-theme');
  assert.equal(resolveTheme(null, false), 'dark');
  assert.equal(resolveTheme(null, true), 'light');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('sepia', true), 'light', 'unknown stored value falls back to the system choice');
  assert.equal(resolveTheme('', false), 'dark');
});

test('theme toggle flips between light and dark', () => {
  assert.equal(oppositeTheme('light'), 'dark');
  assert.equal(oppositeTheme('dark'), 'light');
  assert.equal(oppositeTheme('bogus'), 'light', 'unknown state toggles away from the dark default');
});
