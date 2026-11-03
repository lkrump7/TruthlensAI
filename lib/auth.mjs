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
  if (authEnabled()) {
    throw new Error('AUTH_SECRET is required when AUTH_ENABLED is on. Set AUTH_SECRET before exposing this deployment.');
  }
  if (!warned) {
    warned = true;
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
export const MAX_PASSWORD_LEN = 128;
// Alias kept so older imports keep working.
export const MAX_PASSWORD_LENGTH = MAX_PASSWORD_LEN;

export function verifyPassword(password, stored) {
  // Malformed hashes fail closed with a generic false — never throw, so a
  // corrupt row is indistinguishable from a wrong password. Every path
  // costs exactly one scrypt plus one constant-time compare.
  const parts = String(stored || '').split(':');
  const wellFormed = parts.length === 2 && /^[0-9a-fA-F]{32}$/.test(parts[0]) && /^[0-9a-fA-F]{128}$/.test(parts[1]);
  const salt = wellFormed ? parts[0] : DUMMY_SALT;
  const expected = wellFormed ? Buffer.from(parts[1], 'hex') : DUMMY_EXPECTED;
  const candidate = scryptSync(String(password), salt, 64);
  const match = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  return wellFormed && match;
}
// Fixed dummy hash so unknown users cost the same scrypt work as a wrong
// password. Otherwise the fast null return leaks which names exist.
const DUMMY_SALT = Buffer.alloc(16, 7).toString('hex');
const DUMMY_EXPECTED = scryptSync('invalid-credentials-dummy', DUMMY_SALT, 64);
export const DUMMY_PASSWORD_HASH = `${DUMMY_SALT}:${DUMMY_EXPECTED.toString('hex')}`;

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
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    writeFileSync(tmp, JSON.stringify(users));
    renameSync(tmp, file);
  } catch (e) { console.error(`[truthlens] users persist failed: ${e.message}`); throw e; }
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
  if (String(password || '').length > MAX_PASSWORD_LENGTH) throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  const users = loadUsers();
  const taken = users.some((u) => u.username === name);
  // Always hash, even when the name is taken, so response time does not
  // reveal whether a username exists.
  const passwordHash = hashPassword(password);
  if (taken) throw new Error('Username already exists');
  const user = { username: name, passwordHash, createdAt: new Date().toISOString() };
  users.push(user); saveUsers(users);
  return { username: name };
}

export async function authenticateUser(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const pw = String(password || '');
  const user = loadUsers().find((u) => u.username === name);
  if (pw.length > MAX_PASSWORD_LENGTH) {
    // Fail closed without hashing attacker-controlled megabytes: one dummy
    // check of fixed cost, then a generic null like any other failure.
    verifyPassword('invalid-credentials-dummy', DUMMY_PASSWORD_HASH);
    return null;
  }
  // Missing users and corrupt hashes go through the same scrypt + compare
  // shape as a real check; callers only ever see a generic null.
  const ok = verifyPassword(pw, user ? user.passwordHash : DUMMY_PASSWORD_HASH);
  if (!user || !ok) return null;
  return { username: name };
}

// NOTE (unresolved): sessions are stateless HMAC tokens with no server-side
// record, and there is no password-change endpoint, so nothing today can
// revoke a session before its 7-day expiry — a password change would not
// invalidate existing tokens. Fixing that needs a schema change (a per-user
// token version stored in users.json and embedded in the payload, checked in
// verifySessionToken and bumped on password change). Until then, expiry is
// the only revocation.

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
// Edit gates document writes: like delete, the open workspace allows all
// writes, but with accounts on only the owner may change a document and
// shared demo documents stay read-only. Reads use canView; every route
// that mutates a document must use this instead.
export function canEdit(doc, username) {
  if (!doc) return false;
  if (!authEnabled()) return true;
  return !!username && (doc.owner || 'demo') === username;
}
export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `tl_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure}`;
}
