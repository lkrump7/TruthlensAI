// Bounded concurrency: a FIFO semaphore and an order-preserving map.
// One implementation for live API calls and page fetches alike.
import { CONFIG } from './config.mjs';

export function createLimiter(max = 4) {
  let active = 0;
  const waiting = [];
  const pump = () => { while (active < max && waiting.length) { active++; waiting.shift()(); } };
  return async function run(fn) {
    await new Promise((resolve) => { waiting.push(resolve); pump(); });
    try { return await fn(); }
    finally { active--; pump(); }
  };
}

// Shared across Meta completions and search: the global live-call budget.
export const liveCallLimiter = createLimiter(CONFIG.MAX_CONCURRENT_LIVE_CALLS);

export async function mapWithConcurrency(items, max, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(max, items.length || 1)) }, worker));
  return out;
}
