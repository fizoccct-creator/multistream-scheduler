// Multistream Scheduler: the local server behind the dashboard.
// The desktop app (electron/main.js) starts it. You can also run it alone with `node server.js`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { openFolder, notify } from './lib/notify.js';
import { authEnabled, isSignedIn, login, logout } from './lib/auth.js';
import {
  ROOT, VIDEOS_DIR, getConfig, updateConfig, listJobs, getJob, addJob, updateJob, removeJob, newId,
  listProfiles, getProfile, profileFor, updateProfile, addProfile, removeProfile,
} from './lib/store.js';
import * as youtube from './lib/youtube.js';
import * as facebook from './lib/facebook.js';
import * as obs from './lib/obs.js';
import { probe, getProgress, stopAll } from './lib/streamer.js';
import {
  startScheduler, prepareYouTube, startJob, stopJob, cancelJob, readLog, logFileFor, log,
  PLATFORMS, MANUAL_PLATFORMS, keyFor, findOverlap,
} from './lib/scheduler.js';

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '127.0.0.1';
// On a cloud server, PUBLIC_URL is the address you open in the browser, e.g. https://mystreams.duckdns.org
const BASE_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const HOSTED = !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const SECURE_COOKIE = BASE_URL.startsWith('https://');
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
if (HOSTED) process.env.MS_HOSTED = '1';
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/styles.css']);
const YT_REDIRECT = `${BASE_URL}/auth/youtube/callback`;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.flv', '.avi']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const oauthStates = new Map(); // sign-in state -> profile id

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw new HttpError(413, 'Request too large.');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}

function listVideos() {
  return fs.readdirSync(VIDEOS_DIR)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ name: f, size: fs.statSync(path.join(VIDEOS_DIR, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Never send stream keys back to the browser.
function publicJob(job) {
  const keys = {};
  for (const p of MANUAL_PLATFORMS) {
    const k = job.keys?.[p];
    keys[p] = { saved: Boolean(k?.key), url: k?.url || '' };
  }
  const k = keyFor(job, 'instagram');
  keys.instagram.usesProfileKey = k?.source === 'profile';
  const { ingestUrl, ...yt } = job.youtube || {};
  return { ...job, profileId: profileFor(job).id, keys, youtube: job.youtube ? yt : undefined, progress: getProgress(job.id) };
}

// Profile settings for the browser, without tokens or keys.
function publicProfile(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    obsScene: p.obsScene,
    youtube: { connected: youtube.isConnected(p), channelTitle: p.youtube.channelTitle, privacy: p.youtube.privacy },
    facebook: { connected: facebook.isConnected(p), pageId: p.facebook.pageId, pageName: p.facebook.pageName },
    instagram: { url: p.instagram.url, hasKey: Boolean(p.instagram.url && p.instagram.key) },
  };
}

function diskSpace() {
  try {
    const s = fs.statfsSync(VIDEOS_DIR);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

function publicState() {
  const c = getConfig();
  return {
    now: new Date().toISOString(),
    hosted: HOSTED,
    authEnabled: authEnabled(),
    disk: diskSpace(),
    youtubeClient: { clientId: c.youtube.clientId, hasSecret: Boolean(c.youtube.clientSecret), redirectUri: YT_REDIRECT },
    profiles: listProfiles().map(publicProfile),
    obs: {
      available: !HOSTED, // OBS mode needs OBS on the same computer as this app
      configured: obs.isConfigured(),
      url: c.obs.url || 'ws://127.0.0.1:4455',
      hasPassword: Boolean(c.obs.password),
      version: c.obs.version,
      scenes: c.obs.scenes,
      lastScene: c.obs.lastScene,
    },
    general: c.general,
    videos: listVideos(),
    jobs: listJobs().map(publicJob),
  };
}

async function handleUpload(req, res) {
  let name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || '')))
    .replace(/[^\w.\- ()]+/g, '_').trim();
  const ext = path.extname(name).toLowerCase();
  if (!VIDEO_EXT.has(ext)) throw new HttpError(400, 'Unsupported file type. Use MP4, MOV, M4V, MKV, WEBM, FLV or AVI.');
  const stem = path.basename(name, ext);
  for (let i = 1; fs.existsSync(path.join(VIDEOS_DIR, name)); i++) name = `${stem} (${i})${ext}`;
  const dest = path.join(VIDEOS_DIR, name);
  const tmp = `${dest}.part`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    await probe(tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(400, err.message || 'Upload failed.');
  }
  send(res, 201, { name });
}

async function createJob(req, res) {
  const b = await readJson(req);
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(400, 'Give the stream a title.');
  const video = path.basename(String(b.video || ''));
  const file = path.join(VIDEOS_DIR, video);
  if (!video || !fs.existsSync(file)) throw new HttpError(400, 'Pick a video.');
  const start = Date.parse(b.startAt);
  if (Number.isNaN(start)) throw new HttpError(400, 'Pick a start time.');
  if (start < Date.now() - 60000) throw new HttpError(400, 'That start time has already passed.');

  const profile = getProfile(String(b.profileId || ''));
  if (!profile) throw new HttpError(400, 'Pick a profile.');
  const platforms = {};
  for (const p of PLATFORMS) platforms[p] = Boolean(b.platforms?.[p]);
  if (!getConfig().general.showTiktok) platforms.tiktok = false;
  if (!Object.values(platforms).some(Boolean)) throw new HttpError(400, 'Pick at least one platform.');
  if (platforms.youtube && !youtube.isConnected(profile)) throw new HttpError(400, `Connect ${profile.name}'s YouTube in Settings first, or untick it.`);
  if (platforms.facebook && !facebook.isConnected(profile)) throw new HttpError(400, `Connect ${profile.name}'s Facebook Page in Settings first, or untick it.`);

  const info = await probe(file).catch((err) => { throw new HttpError(400, err.message); });
  if (!info.hasVideo) throw new HttpError(400, 'That file has no video track.');

  const clash = findOverlap({ startAt: new Date(start).toISOString(), durationSec: info.duration });
  if (clash) {
    const when = new Date(clash.startAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    throw new HttpError(409, `This overlaps “${clash.title}” (${profileFor(clash).name}, ${when}). Streams can't run at the same time; pick another time.`);
  }

  const source = b.source === 'obs' ? 'obs' : 'file';
  const obsScene = String(b.obsScene || '').trim();
  if (source === 'obs') {
    if (HOSTED) throw new HttpError(400, 'OBS mode only works when the app runs on the same computer as OBS.');
    if (!obs.isConfigured()) throw new HttpError(400, 'Connect OBS in Settings first.');
    if (!obsScene) throw new HttpError(400, 'Pick the OBS scene to play the video in.');
    updateConfig('obs', { lastScene: obsScene });
    updateProfile(profile.id, { obsScene }); // remember this profile's scene for next time
  }

  const platformStatus = {};
  if (platforms.youtube) platformStatus.youtube = { state: 'pending', message: 'Creating the YouTube broadcast…' };
  if (platforms.facebook) platformStatus.facebook = { state: 'ready', message: 'Goes live by itself at the start time.' };
  const savedIg = profile.instagram.url && profile.instagram.key;
  if (platforms.instagram) {
    platformStatus.instagram = savedIg
      ? { state: 'ready', message: `Uses ${profile.name}'s saved stream key.` }
      : { state: 'needs-key', message: `Paste the stream key, or save one for ${profile.name} in Settings.` };
  }
  if (platforms.tiktok) platformStatus.tiktok = { state: 'needs-key', message: 'Paste the stream key before the start time.' };

  const job = addJob({
    id: newId(),
    profileId: profile.id,
    title,
    description: String(b.description || '').trim(),
    video,
    durationSec: info.duration,
    source,
    obsScene: source === 'obs' ? obsScene : undefined,
    startAt: new Date(start).toISOString(),
    platforms,
    platformStatus,
    keys: {},
    status: 'scheduled',
    reminded: false,
    createdAt: new Date().toISOString(),
  });
  log(job.id, `Scheduled for ${profile.name} at ${new Date(start).toLocaleString()} with ${video}.`);
  if (platforms.youtube) await prepareYouTube(job.id);
  send(res, 201, publicJob(getJob(job.id)));
}

async function saveKey(req, res, job) {
  if (job.status !== 'scheduled' && job.status !== 'missed') throw new HttpError(409, 'Keys can only be added before the stream starts.');
  const b = await readJson(req);
  const platform = String(b.platform);
  if (!MANUAL_PLATFORMS.includes(platform) || !job.platforms[platform]) throw new HttpError(400, 'Unknown platform.');
  const url = String(b.url || '').trim();
  const key = String(b.key || '').trim();
  if (!/^rtmps?:\/\//i.test(url)) throw new HttpError(400, 'The server URL should start with rtmp:// or rtmps://');
  if (!key) throw new HttpError(400, 'Paste the stream key.');
  updateJob(job.id, (j) => ({
    keys: { ...j.keys, [platform]: { url, key } },
    platformStatus: { ...j.platformStatus, [platform]: { state: 'ready', message: 'Stream key saved for this stream only.' } },
  }));
  if (platform === 'tiktok') updateConfig('general', { tiktokUrl: url }); // remember the server URL for next time
  log(job.id, `${platform} stream key saved.`);
  send(res, 200, publicJob(getJob(job.id)));
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  // A custom header stops other websites from sending requests to this app.
  if (method !== 'GET' && req.headers['x-app'] !== '1') throw new HttpError(403, 'Forbidden.');

  if (method === 'GET' && pathname === '/api/state') return send(res, 200, publicState());

  // Shared Google OAuth client (one Google Cloud project works for every profile's channel).
  if (method === 'POST' && pathname === '/api/settings/youtube') {
    const b = await readJson(req);
    const patch = {};
    if (typeof b.clientId === 'string') patch.clientId = b.clientId.trim();
    if (b.clientSecret) patch.clientSecret = String(b.clientSecret).trim();
    updateConfig('youtube', patch);
    return send(res, 200, { ok: true });
  }

  // ---- Profiles (YGC, BYP, ...) ----
  if (method === 'POST' && pathname === '/api/profiles') {
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 24);
    if (!name) throw new HttpError(400, 'Give the profile a name.');
    if (listProfiles().some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'A profile with that name already exists.');
    if (listProfiles().length >= 6) throw new HttpError(400, 'You can have up to 6 profiles.');
    return send(res, 201, publicProfile(addProfile(name)));
  }
  const pm = pathname.match(/^\/api\/profiles\/([a-f0-9]+)(?:\/(youtube\/disconnect|facebook|facebook\/disconnect|instagram|instagram\/clear))?$/);
  if (pm) {
    const profile = getProfile(pm[1]);
    if (!profile) throw new HttpError(404, 'Profile not found.');
    const action = pm[2];
    if (method === 'DELETE' && !action) {
      if (listProfiles().length <= 1) throw new HttpError(400, 'You need at least one profile.');
      const busy = listJobs().some((j) => profileFor(j).id === profile.id && ['scheduled', 'starting', 'live', 'missed'].includes(j.status));
      if (busy) throw new HttpError(409, `${profile.name} has upcoming streams. Cancel or delete them first.`);
      removeProfile(profile.id);
      return send(res, 200, { ok: true });
    }
    if (method !== 'POST') throw new HttpError(404, 'Not found.');
    const b = action === 'youtube/disconnect' || action === 'facebook/disconnect' || action === 'instagram/clear' ? {} : await readJson(req);
    if (!action) {
      const patch = {};
      if (typeof b.name === 'string') {
        const name = b.name.trim().slice(0, 24);
        if (!name) throw new HttpError(400, 'Give the profile a name.');
        if (listProfiles().some((p) => p.id !== profile.id && p.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'A profile with that name already exists.');
        patch.name = name;
      }
      if (['public', 'unlisted', 'private'].includes(b.youtubePrivacy)) patch.youtube = { privacy: b.youtubePrivacy };
      updateProfile(profile.id, patch);
      return send(res, 200, publicProfile(profile));
    }
    if (action === 'youtube/disconnect') {
      youtube.disconnect(profile);
      return send(res, 200, { ok: true });
    }
    if (action === 'facebook') {
      const pageId = String(b.pageId || '').trim();
      const pageToken = String(b.pageToken || '').trim() || profile.facebook.pageToken;
      if (!pageId || !pageToken) throw new HttpError(400, 'Enter both the Page ID and the Page access token.');
      const page = await facebook.verify(pageId, pageToken).catch((err) => { throw new HttpError(400, err.message); });
      updateProfile(profile.id, { facebook: { pageId, pageToken, pageName: page.name || '' } });
      return send(res, 200, { ok: true, pageName: page.name });
    }
    if (action === 'facebook/disconnect') {
      updateProfile(profile.id, { facebook: { pageId: '', pageToken: '', pageName: '' } });
      return send(res, 200, { ok: true });
    }
    if (action === 'instagram') {
      const url = String(b.url || '').trim();
      const key = String(b.key || '').trim() || profile.instagram.key;
      if (!/^rtmps?:\/\//i.test(url)) throw new HttpError(400, 'The server URL should start with rtmp:// or rtmps://');
      if (!key) throw new HttpError(400, 'Paste the stream key.');
      updateProfile(profile.id, { instagram: { url, key } });
      return send(res, 200, { ok: true });
    }
    if (action === 'instagram/clear') {
      updateProfile(profile.id, { instagram: { url: '', key: '' } });
      return send(res, 200, { ok: true });
    }
  }
  if (method === 'POST' && pathname === '/api/settings/general') {
    const b = await readJson(req);
    const clamp = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
    const g = getConfig().general;
    updateConfig('general', {
      reminderMinutes: clamp(b.reminderMinutes, 1, 180, g.reminderMinutes),
      videoBitrateKbps: clamp(b.videoBitrateKbps, 1000, 9000, g.videoBitrateKbps),
      showTiktok: typeof b.showTiktok === 'boolean' ? b.showTiktok : g.showTiktok,
      tiktokUrl: typeof b.tiktokUrl === 'string' ? b.tiktokUrl.trim() : g.tiktokUrl,
    });
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/settings/obs') {
    if (HOSTED) throw new HttpError(400, 'OBS mode only works when the app runs on the same computer as OBS.');
    const b = await readJson(req);
    const url = String(b.url || 'ws://127.0.0.1:4455').trim();
    if (!/^wss?:\/\//.test(url)) throw new HttpError(400, 'The address should start with ws://');
    const password = typeof b.password === 'string' && b.password ? b.password : getConfig().obs.password;
    const info = await obs.getInfo({ url, password }).catch((err) => { throw new HttpError(400, err.message); });
    updateConfig('obs', { url, password, version: info.version, scenes: info.scenes });
    return send(res, 200, { ok: true, ...info });
  }
  if (method === 'POST' && pathname === '/api/obs/refresh') {
    if (!obs.isConfigured()) throw new HttpError(400, 'Connect OBS in Settings first.');
    const info = await obs.getInfo().catch((err) => { throw new HttpError(400, err.message); });
    updateConfig('obs', { version: info.version, scenes: info.scenes });
    return send(res, 200, { ok: true, ...info });
  }
  if (method === 'POST' && pathname === '/api/settings/obs/disconnect') {
    updateConfig('obs', { url: '', password: '', version: '', scenes: [] });
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/settings/notifications') {
    const b = await readJson(req);
    const ntfyServer = String(b.ntfyServer || 'https://ntfy.sh').trim().replace(/\/+$/, '');
    const ntfyTopic = String(b.ntfyTopic || '').trim();
    if (!/^https?:\/\//.test(ntfyServer)) throw new HttpError(400, 'The ntfy server should start with https://');
    if (ntfyTopic && !/^[\w-]{1,64}$/.test(ntfyTopic)) throw new HttpError(400, 'The topic can only use letters, numbers, - and _.');
    updateConfig('general', { ntfyServer, ntfyTopic });
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/settings/notifications/test') {
    if (!getConfig().general.ntfyTopic) throw new HttpError(400, 'Save a topic first.');
    await notify('Test from Multistream Scheduler', 'Phone notifications are working.', { click: BASE_URL, strict: true })
      .catch((err) => { throw new HttpError(502, err.message); });
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/open-videos-folder') {
    if (HOSTED) throw new HttpError(400, 'Not available on a server.');
    openFolder(VIDEOS_DIR);
    return send(res, 200, { ok: true });
  }
  const vm = pathname.match(/^\/api\/videos\/(.+)$/);
  if (method === 'DELETE' && vm) {
    const name = path.basename(decodeURIComponent(vm[1]));
    const file = path.join(VIDEOS_DIR, name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Video not found.');
    const inUse = listJobs().some((j) => j.video === name && ['scheduled', 'starting', 'live', 'missed'].includes(j.status));
    if (inUse) throw new HttpError(409, 'This video is used by an upcoming stream. Cancel or delete that stream first.');
    fs.rmSync(file);
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/upload') return handleUpload(req, res);
  if (method === 'POST' && pathname === '/api/jobs') return createJob(req, res);

  const m = pathname.match(/^\/api\/jobs\/([a-f0-9]+)(?:\/(keys|cancel|stop|start|log))?$/);
  if (m) {
    const job = getJob(m[1]);
    if (!job) throw new HttpError(404, 'Stream not found.');
    const action = m[2];
    if (method === 'GET' && action === 'log') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readLog(job.id));
    }
    if (method === 'POST' && action === 'keys') return saveKey(req, res, job);
    if (method === 'POST' && action === 'cancel') {
      await cancelJob(job.id).catch((err) => { throw new HttpError(409, err.message); });
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'stop') {
      try { stopJob(job.id); } catch (err) { throw new HttpError(409, err.message); }
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'start') {
      await startJob(job.id).catch((err) => { throw new HttpError(409, err.message); });
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE' && !action) {
      if (['starting', 'live'].includes(job.status)) throw new HttpError(409, 'Stop the stream before deleting it.');
      if (job.status === 'scheduled') await cancelJob(job.id).catch(() => {});
      removeJob(job.id);
      fs.rmSync(logFileFor(job.id), { force: true });
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Not found.');
}

function resultPage(res, ok, title, message) {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><style>
:root{--bg:#f6f6f4;--card:#fff;--text:#1b1b19;--muted:#6b6b65;--accent:${ok ? '#1f9d55' : '#d64545'}}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1b1b1a;--text:#ededea;--muted:#9b9b94}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px}
main{background:var(--card);border-radius:14px;padding:32px;max-width:420px;text-align:center;box-shadow:0 2px 12px rgb(0 0 0/.06)}
.i{width:44px;height:44px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;margin:0 auto 14px;font-size:22px}
h1{font-size:20px;margin:0 0 6px}p{color:var(--muted);margin:0}</style></head>
<body><main><div class="i">${ok ? '✓' : '!'}</div><h1>${e(title)}</h1><p>${e(message)}</p></main></body></html>`);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname === '/login' ? 'login.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  securityHeaders(res);
  try {
    // Sign in / sign out (only used when a password is set).
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (req.headers['x-app'] !== '1') throw new HttpError(403, 'Forbidden.');
      const b = await readJson(req);
      res.setHeader('Set-Cookie', login(b.password, SECURE_COOKIE));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', logout(req, SECURE_COOKIE));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/login' && !authEnabled()) return redirect(res, '/');
    if (!isSignedIn(req) && !PUBLIC_PATHS.has(url.pathname)) {
      if (url.pathname.startsWith('/api/')) throw new HttpError(401, 'Please sign in.');
      return redirect(res, '/login');
    }

    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (url.pathname === '/auth/youtube') {
      const { clientId, clientSecret } = getConfig().youtube;
      if (!clientId || !clientSecret) return resultPage(res, false, 'YouTube could not connect', 'Save your Google Client ID and secret in Settings first.');
      const profile = getProfile(url.searchParams.get('profile') || '');
      if (!profile) return resultPage(res, false, 'YouTube could not connect', 'Choose a profile in Settings and click Connect YouTube again.');
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, profile.id);
      return redirect(res, youtube.authUrl(YT_REDIRECT, state));
    }
    if (url.pathname === '/auth/youtube/callback') {
      // Google sign-in happens in your normal web browser, so show a simple "done" page there.
      const state = url.searchParams.get('state');
      try {
        const profile = getProfile(oauthStates.get(state) || '');
        if (!state || !oauthStates.delete(state) || !profile) throw new Error('Sign-in expired. Please try again.');
        if (url.searchParams.get('error')) throw new Error(`Google: ${url.searchParams.get('error')}`);
        await youtube.exchangeCode(profile, url.searchParams.get('code'), YT_REDIRECT);
        return resultPage(res, true, `YouTube is connected for ${profile.name}`, 'You can close this tab and go back to Multistream Scheduler.');
      } catch (err) {
        return resultPage(res, false, 'YouTube could not connect', err.message);
      }
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    throw new HttpError(404, 'Not found.');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message || 'Something went wrong.' });
    else res.end();
  }
}

// Listen on both IPv4 and IPv6 loopback so "localhost" always works. Never exposed to your network.
export function startServer() {
  // Never put the app on the internet without a password.
  if ((HOSTED || !LOOPBACK) && !authEnabled()) {
    return Promise.reject(new Error('Set ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD) before running the app on a server.'));
  }
  return new Promise((resolve, reject) => {
    const main = http.createServer(handler);
    main.requestTimeout = 0; // big video uploads can take a long time
    main.once('error', reject);
    main.listen(PORT, HOST === 'localhost' ? '127.0.0.1' : HOST, () => {
      if (LOOPBACK) {
        const v6 = http.createServer(handler);
        v6.requestTimeout = 0;
        v6.on('error', () => {}); // IPv6 may be unavailable; IPv4 is enough
        v6.listen(PORT, '::1');
      }
      startScheduler({ dashboardUrl: BASE_URL });
      resolve({ url: BASE_URL, port: PORT });
    });
  });
}

export { stopAll };

// Running directly with `node server.js` (no desktop window).
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  startServer().then(
    () => {
      console.log(`\n  Multistream Scheduler is running at ${BASE_URL}`);
      console.log('  Keep this window open (and your computer awake) for scheduled streams to start.\n');
    },
    (err) => {
      console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Is the app already running?` : err.message || err);
      process.exit(1);
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopAll();
      setTimeout(() => process.exit(0), 1500);
    });
  }
}
