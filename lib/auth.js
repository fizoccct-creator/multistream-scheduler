// Single-user password login for the hosted version.
// Turned on when ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD) is set. The desktop app doesn't need it.
//
// Make a hash for the env file:   printf '%s' 'your password' | node lib/auth.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COOKIE = 'ms_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in for 30 days
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---- Command line: print a hash for the password read from stdin ----
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const input = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (input.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  console.log(hashPassword(input));
  process.exit(0);
}

// ---- Server side ----
const { DATA_DIR } = await import('./store.js');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH
  || (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : '');

export const authEnabled = () => Boolean(PASSWORD_HASH);

// Sessions are saved as SHA-256 hashes of the cookie value, so the file alone can't be used to sign in.
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
let sessions = {};
try {
  sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
} catch {
  sessions = {};
}
function saveSessions() {
  const now = Date.now();
  for (const [k, exp] of Object.entries(sessions)) if (exp < now) delete sessions[k];
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions), { mode: 0o600 });
}

const fails = [];

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

export function isSignedIn(req) {
  if (!authEnabled()) return true;
  const token = readCookie(req);
  if (!token) return false;
  const exp = sessions[tokenHash(token)];
  return Boolean(exp && exp > Date.now());
}

// Returns a Set-Cookie header value, or throws with .status set.
export function login(password, secure) {
  const now = Date.now();
  while (fails.length && now - fails[0] > FAIL_WINDOW_MS) fails.shift();
  if (fails.length >= MAX_FAILS) {
    const err = new Error('Too many wrong passwords. Try again in 15 minutes.');
    err.status = 429;
    throw err;
  }
  if (!verifyPassword(password || '', PASSWORD_HASH)) {
    fails.push(now);
    const err = new Error('Wrong password.');
    err.status = 401;
    throw err;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[tokenHash(token)] = now + SESSION_MS;
  saveSessions();
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function logout(req, secure) {
  const token = readCookie(req);
  if (token) {
    delete sessions[tokenHash(token)];
    saveSessions();
  }
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
