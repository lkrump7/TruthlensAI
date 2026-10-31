import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/verify/stream/route.js';

test('demo stream does not claim graph stages that never ran', async () => {
  const req = new Request('http://x/api/verify/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim: 'Water boils at 100 degrees Celsius at sea level.' }) });
  const res = await POST(req);
  const body = await res.text();
  assert.ok(!body.includes('"stage":"judge"'), 'demo mode must not emit a judge stage');
  assert.ok(!body.includes('"trajectory"'), 'demo record must not carry an invented trajectory');
  assert.ok(body.includes('"kind":"verdict"'), 'verdict event still arrives');
});
