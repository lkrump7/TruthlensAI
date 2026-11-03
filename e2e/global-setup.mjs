import { rmSync, mkdirSync } from 'node:fs';

// Runs before the browser suite (after the dev server boots): start from an
// empty, isolated document store so scenarios never pollute the developer's
// data/documents.json and never contend with parallel node:test processes
// over its file lock. The store paths themselves come from webServer.env in
// playwright.config.mjs; this file only empties them.
const dir = new URL('../test-results/e2e-store/', import.meta.url);

export default async function globalSetup() {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
