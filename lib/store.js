// Simple JSON-file storage for settings and scheduled streams.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
// The desktop app sets these to the user's app-data folder; otherwise use folders next to the code.
export const DATA_DIR = process.env.MS_DATA_DIR || path.join(ROOT, 'data');
export const VIDEOS_DIR = process.env.MS_VIDEOS_DIR || path.join(ROOT, 'videos');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');

for (const dir of [DATA_DIR, VIDEOS_DIR, LOGS_DIR]) fs.mkdirSync(dir, { recursive: true });

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

const DEFAULT_CONFIG = {
  // The Google Cloud OAuth client is shared; each profile signs in to its own YouTube channel.
  youtube: { clientId: '', clientSecret: '' },
  // OBS Studio's built-in WebSocket server (Tools → WebSocket Server Settings)
  obs: { url: '', password: '', version: '', scenes: [], lastScene: '' },
  general: {
    reminderMinutes: 15,
    videoBitrateKbps: 4500,
    showTiktok: false, // hidden for now; turn on in Settings → General
    tiktokUrl: '',
    ntfyServer: 'https://ntfy.sh', // phone notifications via the free ntfy app
    ntfyTopic: '',
  },
};

// A profile is one brand (e.g. YGC or BYP) with its own channels and keys.
export const PROFILE_COLORS = ['#2f62c9', '#d97706', '#1f8a4c', '#9333ea', '#db2777', '#0891b2'];
export function blankProfile(name, color) {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    name,
    color,
    youtube: { refreshToken: '', channelTitle: '', privacy: 'public' },
    facebook: { pageId: '', pageToken: '', pageName: '' },
    instagram: { url: '', key: '' }, // saved key, reused for every stream
    obsScene: '',
  };
}

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

// Write to a temp file first so a crash never leaves a half-written file.
function write(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const saved = read(CONFIG_FILE, {});
const config = {};
for (const section of Object.keys(DEFAULT_CONFIG)) {
  config[section] = { ...DEFAULT_CONFIG[section], ...(saved[section] || {}) };
}

// Profiles. Older versions had one YouTube/Facebook/Instagram setup: move it into the first profile.
config.profiles = Array.isArray(saved.profiles) ? saved.profiles : null;
if (!config.profiles) {
  const ygc = blankProfile('YGC', PROFILE_COLORS[0]);
  const oldYt = saved.youtube || {};
  ygc.youtube = { refreshToken: oldYt.refreshToken || '', channelTitle: oldYt.channelTitle || '', privacy: oldYt.privacy || 'public' };
  if (saved.facebook) ygc.facebook = { pageId: '', pageToken: '', pageName: '', ...saved.facebook };
  ygc.instagram.url = saved.general?.instagramUrl || '';
  ygc.obsScene = saved.obs?.lastScene || '';
  config.profiles = [ygc, blankProfile('BYP', PROFILE_COLORS[1])];
}
delete config.youtube.refreshToken;
delete config.youtube.channelTitle;
delete config.youtube.privacy;
delete config.general.instagramUrl;
for (const p of config.profiles) {
  const fresh = blankProfile(p.name, p.color);
  for (const k of ['youtube', 'facebook', 'instagram']) p[k] = { ...fresh[k], ...(p[k] || {}) };
}
write(CONFIG_FILE, config);

let jobs = read(JOBS_FILE, []);

export const getConfig = () => config;

export function updateConfig(section, patch) {
  config[section] = { ...config[section], ...patch };
  write(CONFIG_FILE, config);
  return config[section];
}

export const listProfiles = () => config.profiles;
export const getProfile = (id) => config.profiles.find((p) => p.id === id) || null;
// Old streams (before profiles) belong to the first profile.
export const profileFor = (job) => getProfile(job.profileId) || config.profiles[0];

// patch: { name?, color?, obsScene?, youtube?: {...}, facebook?: {...}, instagram?: {...} } (merged)
export function updateProfile(id, patch) {
  const p = getProfile(id);
  if (!p) return null;
  for (const [k, v] of Object.entries(patch)) {
    p[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...p[k], ...v } : v;
  }
  write(CONFIG_FILE, config);
  return p;
}

export function addProfile(name) {
  const used = new Set(config.profiles.map((p) => p.color));
  const color = PROFILE_COLORS.find((c) => !used.has(c)) || PROFILE_COLORS[config.profiles.length % PROFILE_COLORS.length];
  const p = blankProfile(name, color);
  config.profiles.push(p);
  write(CONFIG_FILE, config);
  return p;
}

export function removeProfile(id) {
  config.profiles = config.profiles.filter((p) => p.id !== id);
  write(CONFIG_FILE, config);
}

export const listJobs = () => jobs;
export const getJob = (id) => jobs.find((j) => j.id === id);
export const newId = () => crypto.randomBytes(6).toString('hex');

function saveJobs() {
  write(JOBS_FILE, jobs);
}

export function addJob(job) {
  jobs.push(job);
  saveJobs();
  return job;
}

// patch can be an object or a function (job) => object
export function updateJob(id, patch) {
  const job = getJob(id);
  if (!job) return null;
  Object.assign(job, typeof patch === 'function' ? patch(job) : patch);
  saveJobs();
  return job;
}

export function removeJob(id) {
  jobs = jobs.filter((j) => j.id !== id);
  saveJobs();
}
