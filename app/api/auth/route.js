import { registerUser, authenticateUser, createSessionToken, currentUser, sessionCookie, authSecret, authEnabled } from '../../../lib/auth.mjs';
import { createBoundedLimiter, clientIp, bodyTooLarge, originCheckFailed } from '../../../lib/rate-limit.mjs';

const authLimiter = createBoundedLimiter({ windowMs: 15 * 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function rateLimited(key) {
  return authLimiter.check(key);
}

const NO_STORE = { 'cache-control': 'no-store' };

function clearCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `tl_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export async function GET(req) {
  const enabled = authEnabled();
  const user = enabled ? currentUser(req) : null;
  return Response.json({ user: user?.username || null, authEnabled: enabled }, { headers: NO_STORE });
}

export async function POST(req) {
  if (bodyTooLarge(req)) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
  if (originCheckFailed(req)) return Response.json({ error: 'Origin check failed.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { action, username, password } = body;
  if (!authEnabled() && action !== 'logout') {
    return Response.json({ error: 'Accounts are turned off on this deployment. You can use everything without signing in.' }, { status: 403 });
  }
  const limitKey = `${action || ''}:${String(username || '').toLowerCase()}:${clientIp(req)}`;
  if (action !== 'logout' && rateLimited(limitKey)) return Response.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': '900' } });
  try {
    if (action === 'logout') {
      return new Response(JSON.stringify({ user: null }), { headers: { 'content-type': 'application/json', 'set-cookie': clearCookie(), ...NO_STORE } });
    }
    if (action === 'register') await registerUser(username, password);
    else if (action !== 'login') return Response.json({ error: 'Unknown action.' }, { status: 400 });
    const user = await authenticateUser(username, password);
    if (!user) return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
    const token = createSessionToken(user.username, authSecret());
    return new Response(JSON.stringify({ user: user.username }), { headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(token), ...NO_STORE } });
  } catch (e) {
    console.error(e);
    if (action === 'register') return Response.json({ error: 'Registration failed. Check the username and password, or try a different username.' }, { status: 400 });
    return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  }
}
