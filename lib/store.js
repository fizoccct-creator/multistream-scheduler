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
  youtube: { clientId: '', clientSecret: '', refreshToken: '', channelTitle: '', privacy: 'public' },
  facebook: { pageId: '', pageToken: '', pageName: '' },
  general: {
    reminderMinutes: 15,
    videoBitrateKbps: 4500,
    instagramUrl: '',
    tiktokUrl: '',
    ntfyServer: 'https://ntfy.sh', // phone notifications via the free ntfy app
    ntfyTopic: '',
  },
};

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

let jobs = read(JOBS_FILE, []);

export const getConfig = () => config;

export function updateConfig(section, patch) {
  config[section] = { ...config[section], ...patch };
  write(CONFIG_FILE, config);
  return config[section];
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
