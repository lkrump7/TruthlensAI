import { verifyClaim, DEMO_EVIDENCE } from '../../../lib/engine.mjs';
import { liveStatus, getModels } from '../../../lib/meta.mjs';
import { verifyResearchedClaim } from '../../../lib/research.mjs';
import { CONFIG } from '../../../lib/config.mjs';

export async function POST(req) {
  const { claim } = await req.json().catch(() => ({}));
  if (!claim || !String(claim).trim()) return Response.json({ error: 'Enter a claim first.' }, { status: 400 });
  if (String(claim).length > CONFIG.MAX_CLAIM_CHARS) return Response.json({ error: `Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.` }, { status: 413 });
  const text = String(claim).trim();
  const status = liveStatus();
  if (!status.configured) {
    const base = await verifyClaim({ text }, DEMO_EVIDENCE);
    return Response.json({ ...base, mode: 'demo', models: getModels(), missing: status.missing });
  }
  try {
    const live = await verifyResearchedClaim(text);
    return Response.json({ ...live, models: getModels() });
  } catch (err) {
    return Response.json({ text, type: 'Scientific', verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], mode: 'live-failed', models: getModels(), explanation: 'Live research failed, so no verdict was produced rather than falling back to a canned one.', limitations: [`Live research failed (${err.message}). Retry the claim.`] });
  }
}
