import { registerUser, authenticateUser, createSessionToken, currentUser, sessionCookie, authSecret } from '../../../lib/auth.mjs';

export async function GET(req) {
  const user = currentUser(req);
  return Response.json({ user: user?.username || null });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, username, password } = body;
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
    return Response.json({ error: e.message }, { status: 400 });
  }
}
