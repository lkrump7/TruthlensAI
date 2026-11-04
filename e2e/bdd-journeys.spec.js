import { test, expect } from '@playwright/test';

// Browser BDD: Given–When–Then names; each test drives the real UI in demo
// mode (Meta keys blanked by playwright.config.mjs, so no live credits).

test('Given the app, when it loads, then the demo workspace is usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Check tools' }).first()).toBeVisible();
  await expect(page.getByLabel('Claim to verify. Type or dictate with the mic.')).toBeVisible();
});

test('Given a known claim, when verified in the browser, then a Contradicted verdict renders with cited evidence', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Claim to verify. Type or dictate with the mic.').fill('Humans only use 10% of their brains.');
  await page.getByRole('button', { name: 'Verify' }).click();
  const panel = page.locator('[data-verdict-panel]');
  await expect(panel).toBeVisible({ timeout: 90000 });
  await expect(panel.getByText('Contradicted').first()).toBeVisible();
  await expect(panel.locator('[data-evidence-card]').first()).toBeVisible();
});

test('Given pasted excerpt text, when uploaded in the browser, then the document appears and survives reload', async ({ page }) => {
  const title = `E2E Excerpt ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Check an excerpt' }).click();
  await page.getByRole('button', { name: 'Ingest a new manuscript' }).click();
  await page.getByPlaceholder('Paste text here. Long text is fine.').fill(
    'Water boils at 100 degrees Celsius at sea level in kitchens around the world. Photosynthesis converts light into chemical energy in green leaves daily.'
  );
  await page.getByPlaceholder('File title').fill(title);
  await page.getByRole('button', { name: 'Find claims and check' }).click();
  // Upload lands on the library tab; the vault card lives there, not on the
  // excerpt tool page.
  await page.getByRole('button', { name: /Workspace Library/ }).click();
  await expect(page.getByRole('button', { name: `Open claims for ${title}` })).toBeVisible({ timeout: 90000 });
  await page.reload();
  await page.getByRole('button', { name: /Workspace Library/ }).click();
  await expect(page.getByRole('button', { name: `Open claims for ${title}` })).toBeVisible({ timeout: 90000 });
});

test('Given a verified document claim, when exported in the browser, then a markdown dossier downloads', async ({ page }) => {
  const title = `E2E Export ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Check an excerpt' }).click();
  await page.getByRole('button', { name: 'Ingest a new manuscript' }).click();
  await page.getByPlaceholder('Paste text here. Long text is fine.').fill(
    'Water boils at 100 degrees Celsius at sea level in kitchens around the world.'
  );
  await page.getByPlaceholder('File title').fill(title);
  await page.getByRole('button', { name: 'Find claims and check' }).click();
  // Stay in the dossier: the vault card opens this upload's claim list, and
  // picking the decided claim renders its verdict page with a report button.
  await page.getByRole('button', { name: `Open claims for ${title}` }).click();
  await page.getByRole('button', { name: /Water boils at 100 degrees.*Supported/ }).click();
  const downloadButton = page.getByRole('button', { name: 'Download report' });
  await expect(downloadButton).toBeVisible({ timeout: 120000 });
  const download = page.waitForEvent('download', { timeout: 30000 });
  await downloadButton.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('truthlens-investigation.md');
});
