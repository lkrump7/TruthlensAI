import { test, expect } from '@playwright/test';

// BDD: mic recorder with a working microphone. The chromium-fake-mic project
// feeds Chromium a fake media stream, so getUserMedia succeeds and the hold-
// to-talk path must reach Listening. Release must end the session: the
// Listening indicator goes away (what follows is a transcribe attempt, which
// in demo mode names its own outcome instead of hanging on Listening).
test.use({ permissions: ['microphone'] });

test('Given a microphone, when I hold the dictate mic, then it listens and release ends it', async ({
  page,
}) => {
  await page.goto('/');
  const mic = page.getByRole('button', { name: /Muse Voice Transcribe/ }).first();
  await expect(mic).toBeVisible();

  await mic.hover();
  await page.mouse.down();
  await expect(page.getByText(/Listening.+release/i).first()).toBeVisible({ timeout: 15000 });
  await page.mouse.up();
  await expect(page.getByText(/Listening.+release/i)).toHaveCount(0, { timeout: 15000 });
});
