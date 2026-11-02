import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { suggestFollowups, localSuggestions } from '../../../../lib/suggest.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';

// Follow-up suggestions for one finished verdict. Live deployments ask
// Muse Spark to reason over the claim and its passages. When Meta calls
// are unavailable (including deliberately paused), the local evidence-
// derived questions are returned and labelled source: 'local'.
export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = body.result || {};
  if (!String(result.text || '').trim() || !String(result.verdict || '').trim()) {
    return Response.json({ error: 'A finished verdict is needed before suggestions can be made.' }, { status: 400 });
  }
  if (!liveStatus().configured) {
    return Response.json({ suggestions: localSuggestions(result), source: 'local', models: getModels() });
  }
  try {
    const out = await suggestFollowups(result);
    return Response.json({ ...out, models: getModels() });
  } catch {
    return Response.json({ suggestions: localSuggestions(result), source: 'local', reason: 'ai-failed', models: getModels() });
  }
}
