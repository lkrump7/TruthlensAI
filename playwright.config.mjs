import { defineConfig, devices } from '@playwright/test';

// BDD browser layer: only flows route tests cannot prove (real upload,
// streamed progress, rendered citations, reload persistence, file download).
// webServer blanks the Meta credentials so every run stays in demo mode:
// zero live credits, deterministic canned verdicts.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.mjs',
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3300',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Direct next invocation: `npm run dev -- -p 3300` expands to two `-p`
    // flags and only works by last-wins. This states the port exactly once.
    command: 'npx next dev -p 3300',
    url: 'http://127.0.0.1:3300',
    // Never attach to a foreign server: another project already answers on
    // 3100 in this environment, which silently redirected every scenario to
    // a stranger's /sign-in page.
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      META_MODEL_API_URL: '',
      META_MODEL_API_KEY: '',
      TRUTHLENS_NO_CHALLENGE: '1',
      TRUTHLENS_NO_NLI: '1',
      // Isolated store: browser runs must not write the developer's
      // data/documents.json (bloat + file-lock contention with node:test).
      TRUTHLENS_STORE_FILE: './test-results/e2e-store/documents.json',
      TRUTHLENS_USERS_FILE: './test-results/e2e-store/users.json',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
