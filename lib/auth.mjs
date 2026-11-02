import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Local account auth: scrypt password hashes, HMAC-signed session cookies.
// AUTH_SECRET signs sessions in production; the dev default is labelled as such.
const USERS_FILE = () => process.env.TRUTHLENS_USERS_FILE || 'data/users.json';
const DEV_SECRET = 'dev-only-secret-change-me';
let warned = false;
export function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (authEnabled() && !warned) {
    warned = true;
    console.error('[truthlens] AUTH_SECRET is not set while AUTH_ENABLED is on. Sessions use the local dev secret; set AUTH_SECRET before exposing this deployment.');
  }
  return DEV_SECRET;
}

// Accounts are opt-in. Default (unset): no sign-in anywhere, and every
// visitor shares the open workspace with full capability. Set
// AUTH_ENABLED=true (or 1) to require accounts and owner-scope documents.
export function authEnabled(env = process.env) {
  return ['true', '1'].includes(String(env.AUTH_ENABLED || '').trim().toLowerCase());
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(password), salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function loadUsers() {
  const file = USERS_FILE();
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try { copyFileSync(file, aside); } catch { /* quarantine is best-effort */ }
    console.error(`[truthlens] users file corrupt, preserved at ${aside}: ${e.message}`);
    return [];
  }
}
function saveUsers(users) {
  try {
    const file = USERS_FILE();
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(users));
    renameSync(tmp, file);
  } catch (e) { console.error(`[truthlens] users persist failed: ${e.message}`); }
}

let userChain = Promise.resolve();
export function registerUser(username, password) {
  const run = userChain.then(() => registerUserLocked(username, password));
  userChain = run.then(() => {}, () => {});
  return run;
}

async function registerUserLocked(username, password) {
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw new Error('Username must be 3-32 letters, numbers, dots, dashes or underscores');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters');
  const users = loadUsers();
  if (users.some((u) => u.username === name)) throw new Error('Username already exists');
  const user = { username: name, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  users.push(user); saveUsers(users);
  return { username: name };
}

export async function authenticateUser(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const user = loadUsers().find((u) => u.username === name);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return { username: name };
}

export function createSessionToken(username, secret, ttlMs = 7 * 24 * 3600 * 1000) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifySessionToken(token, secret) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    return { username: data.u };
  } catch { return null; }
}

export function currentUser(req) {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)tl_session=([^;]+)/);
  if (!match) return null;
  let token;
  try { token = decodeURIComponent(match[1]); } catch { return null; }
  return verifySessionToken(token, authSecret());
}
// The user a request counts as for ownership. With accounts off this is
// always null, so documents land in the shared workspace.
export function requestUser(req) {
  return authEnabled() ? currentUser(req) : null;
}
// Shared document visibility. Accounts off: every document is visible.
// Accounts on: only the owner, or a demo document, is visible.
export function canView(doc, username) {
  if (!doc) return false;
  if (!authEnabled()) return true;
  const owner = doc.owner || 'demo';
  return owner === 'demo' || owner === username;
}
// Delete is stricter than view: shared demo documents stay readable by
// everyone but removable only with accounts off (open workspace).
export function canDelete(doc, username) {
  if (!doc) return false;
  if (!authEnabled()) return true;
  return !!username && (doc.owner || 'demo') === username;
}
export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `tl_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure}`;
}
