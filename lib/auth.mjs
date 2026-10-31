import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Local account auth: scrypt password hashes, HMAC-signed session cookies.
// AUTH_SECRET signs sessions in production; the dev default is labelled as such.
const USERS_FILE = () => process.env.TRUTHLENS_USERS_FILE || 'data/users.json';
export function authSecret() { return process.env.AUTH_SECRET || 'dev-only-secret-change-me'; }

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
  try { return existsSync(USERS_FILE()) ? JSON.parse(readFileSync(USERS_FILE(), 'utf8')) : []; } catch { return []; }
}
function saveUsers(users) {
  try { mkdirSync(dirname(USERS_FILE()), { recursive: true }); writeFileSync(USERS_FILE(), JSON.stringify(users)); }
  catch (e) { console.error(`[truthlens] users persist failed: ${e.message}`); }
}

export async function registerUser(username, password) {
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
  return verifySessionToken(decodeURIComponent(match[1]), authSecret());
}
// The user a request counts as for ownership. With accounts off this is
// always null, so documents land in the shared workspace.
export function requestUser(req) {
  return authEnabled() ? currentUser(req) : null;
}
export function sessionCookie(token) {
  return `tl_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
}
