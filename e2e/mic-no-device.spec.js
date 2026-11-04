import { test, expect } from '@playwright/test';

// BDD: mic recorder with no microphone device (default headless Chromium has
// none, so getUserMedia rejects with NotFoundError — the exact message in the
// bug report screenshot). Proves the note names the cause and Dismiss clears it.

test('Given no microphone, when I hold the dictate mic, then a no-mic note shows and Dismiss clears it', async ({
  page,
}) => {
  await page.goto('/');
  const mic = page.getByRole('button', { name: /Muse Voice Transcribe/ }).first();
  await expect(mic).toBeVisible();

  await mic.hover();
  await page.mouse.down();
  await expect(page.getByText('No microphone found')).toBeVisible({ timeout: 15000 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Dismiss microphone message' }).click();
  await expect(page.getByText('No microphone found')).toHaveCount(0);
});
