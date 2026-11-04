import { test, expect } from '@playwright/test';

// BDD: the bug-report case. The OS default input is missing (first open fails
// with NotFoundError) but enumeration lists a usable microphone. The recorder
// must retry that listed device instead of reporting "No microphone found".

test('Given a listed microphone whose default open fails, when I hold the dictate mic, then it retries the listed device and listens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__micCalls = [];
    const media = navigator.mediaDevices;
    const realGUM = media.getUserMedia.bind(media);
    const realEnum = media.enumerateDevices.bind(media);
    let first = true;
    media.getUserMedia = async (constraints) => {
      window.__micCalls.push(JSON.parse(JSON.stringify(constraints ?? null)));
      if (first) {
        first = false;
        throw new DOMException('mock: default input missing', 'NotFoundError');
      }
      const audio = constraints && constraints.audio;
      if (audio && typeof audio === 'object' && audio.deviceId) {
        // Stand in for the OS opening the listed device successfully.
        const { deviceId: _drop, ...rest } = audio;
        return realGUM({ audio: Object.keys(rest).length ? rest : true });
      }
      return realGUM(constraints);
    };
    media.enumerateDevices = async () => [
      { deviceId: 'listed-mic-1', kind: 'audioinput', label: 'Listed microphone', groupId: '' },
      ...(await realEnum()),
    ];
  });

  await page.goto('/');
  const mic = page.getByRole('button', { name: /Muse Voice Transcribe/ }).first();
  await expect(mic).toBeVisible();

  await mic.hover();
  await page.mouse.down();
  await expect(page.getByText(/Listening.+release/i).first()).toBeVisible({ timeout: 15000 });
  await page.mouse.up();
  await expect(page.getByText(/Listening.+release/i)).toHaveCount(0, { timeout: 15000 });

  const calls = await page.evaluate(() => window.__micCalls);
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls[1]?.audio?.deviceId?.exact).toBe('listed-mic-1');
  await expect(page.getByText('No microphone found')).toHaveCount(0);
});
