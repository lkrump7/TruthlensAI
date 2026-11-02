import { test } from 'node:test';
import assert from 'node:assert/strict';

const { pdfUploadTooLarge } = await import('../app/api/documents/pdf/route.js');

test('pdfUploadTooLarge rejects on real bytes even when file.size lies', () => {
  const MAX = 15 * 1024 * 1024;
  assert.equal(pdfUploadTooLarge(1, MAX + 1), true, 'lying file.size cannot bypass the real-bytes check');
  assert.equal(pdfUploadTooLarge(1, 100), false);
  assert.equal(pdfUploadTooLarge(MAX + 1, 100), true, 'declared size is still checked');
});
