import { registerUser, authenticateUser, createSessionToken, currentUser, sessionCookie, authSecret, authEnabled } from '../../../lib/auth.mjs';

const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  hits.push(now);
  attempts.set(key, hits);
  return hits.length > 10;
}

export async function GET(req) {
  const enabled = authEnabled();
  const user = enabled ? currentUser(req) : null;
  return Response.json({ user: user?.username || null, authEnabled: enabled });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, username, password } = body;
  if (!authEnabled() && action !== 'logout') {
    return Response.json({ error: 'Accounts are turned off on this deployment. You can use everything without signing in.' }, { status: 403 });
  }
  const limitKey = `${action || ''}:${String(username || '').toLowerCase()}`;
  if (action !== 'logout' && rateLimited(limitKey)) return Response.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': '900' } });
  try {
    if (action === 'logout') {
      return new Response(JSON.stringify({ user: null }), { headers: { 'content-type': 'application/json', 'set-cookie': 'tl_session=; HttpOnly; Path=/; Max-Age=0' } });
    }
    if (action === 'register') await registerUser(username, password);
    else if (action !== 'login') return Response.json({ error: 'Unknown action.' }, { status: 400 });
    const user = await authenticateUser(username, password);
    if (!user) return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
    const token = createSessionToken(user.username, authSecret());
    return new Response(JSON.stringify({ user: user.username }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(token) } });
  } catch (e) {
    if (action === 'register') return Response.json({ error: 'Registration failed. Check the username and password, or try a different username.' }, { status: 400 });
    return Response.json({ error: e.message }, { status: 400 });
  }
}
