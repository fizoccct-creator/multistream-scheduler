// Watches the schedule: reminds you about Instagram/TikTok keys, then starts streams on time.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, listJobs, getJob, updateJob, VIDEOS_DIR, LOGS_DIR } from './store.js';
import * as youtube from './youtube.js';
import * as facebook from './facebook.js';
import { startStream, stopStream } from './streamer.js';
import { notify, openUrl } from './notify.js';

export const PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'];
export const MANUAL_PLATFORMS = ['instagram', 'tiktok'];
export const NAMES = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

const MISSED_AFTER_MS = 30 * 60 * 1000; // give up if the app was off for 30+ min past start
const TICK_MS = 5000;
let dashboardUrl = 'http://localhost:3030';

const jobLink = (id) => `${dashboardUrl}/#job-${id}`;

export const logFileFor = (id) => path.join(LOGS_DIR, `${id}.log`);

export function log(id, message) {
  fs.appendFileSync(logFileFor(id), `[${new Date().toLocaleString()}] ${message}\n`);
}

export function readLog(id) {
  try {
    return fs.readFileSync(logFileFor(id), 'utf8').split('\n').slice(-300).join('\n');
  } catch {
    return '';
  }
}

function setPlatform(id, platform, state, message) {
  updateJob(id, (j) => ({ platformStatus: { ...j.platformStatus, [platform]: { state, message } } }));
}

export function joinRtmp(url, key) {
  return `${url.trim().replace(/\/+$/, '')}/${key.trim().replace(/^\/+/, '')}`;
}

export async function prepareYouTube(id) {
  const job = getJob(id);
  if (!job) return;
  try {
    const yt = await youtube.createBroadcast(job);
    updateJob(id, { youtube: yt });
    setPlatform(id, 'youtube', 'ready', 'Scheduled on YouTube. Goes live by itself.');
    log(id, `YouTube broadcast created: ${yt.watchUrl}`);
  } catch (err) {
    setPlatform(id, 'youtube', 'error', err.message);
    log(id, `YouTube setup failed: ${err.message}`);
  }
}

export async function startJob(id) {
  const job = getJob(id);
  if (!job || !['scheduled', 'missed'].includes(job.status)) throw new Error('This stream cannot be started now.');
  updateJob(id, { status: 'starting', error: null }); // set before any await so it never starts twice
  log(id, 'Start time reached. Preparing platforms.');

  const outputs = [];
  if (job.platforms.youtube) {
    try {
      let yt = job.youtube;
      if (!yt?.ingestUrl) {
        yt = await youtube.createBroadcast(job);
        updateJob(id, { youtube: yt });
      }
      outputs.push({ platform: 'youtube', url: yt.ingestUrl });
    } catch (err) {
      setPlatform(id, 'youtube', 'error', err.message);
      log(id, `YouTube failed: ${err.message}`);
    }
  }
  if (job.platforms.facebook) {
    try {
      const fb = await facebook.createLiveVideo(job);
      updateJob(id, { facebook: { liveVideoId: fb.liveVideoId } });
      outputs.push({ platform: 'facebook', url: fb.ingestUrl });
      log(id, `Facebook live video created (${fb.liveVideoId}).`);
    } catch (err) {
      setPlatform(id, 'facebook', 'error', err.message);
      log(id, `Facebook failed: ${err.message}`);
    }
  }
  for (const p of MANUAL_PLATFORMS) {
    if (!job.platforms[p]) continue;
    const k = getJob(id).keys?.[p];
    if (k?.url && k?.key) {
      outputs.push({ platform: p, url: joinRtmp(k.url, k.key) });
    } else {
      setPlatform(id, p, 'skipped', 'Skipped: no stream key was added before the start time.');
      log(id, `${NAMES[p]} skipped: no stream key.`);
    }
  }

  const file = path.join(VIDEOS_DIR, job.video);
  const fail = async (message) => {
    log(id, message);
    await endFacebook(id);
    updateJob(id, { status: 'failed', error: message, keys: {}, endedAt: new Date().toISOString() });
    notify('Stream failed', `“${job.title}”: ${message}`, { click: jobLink(id) });
  };
  if (!outputs.length) return fail('No platform was ready, so nothing was streamed.');
  if (!fs.existsSync(file)) return fail(`The video file is missing: ${job.video}`);

  for (const o of outputs) setPlatform(id, o.platform, 'live', 'Streaming now');
  updateJob(id, { status: 'live', startedAt: new Date().toISOString() });
  notify('Stream started', `“${job.title}” is live on ${outputs.map((o) => NAMES[o.platform]).join(', ')}.`, { click: jobLink(id) });

  try {
    await startStream({
      id,
      file,
      outputs,
      logFile: logFileFor(id),
      bitrateKbps: getConfig().general.videoBitrateKbps,
      onExit: (result) => finishJob(id, outputs, result),
    });
  } catch (err) {
    for (const o of outputs) setPlatform(id, o.platform, 'error', 'Did not start');
    await fail(err.message);
  }
}

async function endFacebook(id) {
  const liveVideoId = getJob(id)?.facebook?.liveVideoId;
  if (!liveVideoId) return;
  try {
    await facebook.endLiveVideo(liveVideoId);
  } catch (err) {
    log(id, `Could not end the Facebook live video: ${err.message}`);
  }
}

async function finishJob(id, outputs, { code, stopped, error, failedPlatforms }) {
  const job = getJob(id);
  if (!job) return;
  const ok = stopped || code === 0;
  for (const o of outputs) {
    const droppedOut = failedPlatforms.includes(o.platform);
    if (droppedOut) setPlatform(id, o.platform, 'error', 'Connection to this platform failed. See the log.');
    else setPlatform(id, o.platform, ok ? 'done' : 'error', ok ? (stopped ? 'Stopped' : 'Finished') : 'Ended with an error');
  }
  await endFacebook(id);
  const message = error || `FFmpeg stopped with exit code ${code}. See the log for details.`;
  updateJob(id, {
    status: ok ? 'done' : 'failed',
    error: ok ? null : message,
    keys: {}, // Instagram and TikTok keys are single-use, so don't keep them
    endedAt: new Date().toISOString(),
  });
  log(id, ok ? (stopped ? 'Stream stopped.' : 'Stream finished.') : `Stream failed: ${message}`);
  notify(ok ? 'Stream finished' : 'Stream failed', `“${job.title}” ${ok ? 'has ended.' : 'stopped with an error.'}`, { click: jobLink(id) });
}

export async function cancelJob(id) {
  const job = getJob(id);
  if (!job || !['scheduled', 'missed'].includes(job.status)) throw new Error('Only upcoming streams can be canceled.');
  updateJob(id, { status: 'canceled', keys: {} });
  log(id, 'Canceled.');
  if (job.youtube?.broadcastId) {
    try {
      await youtube.deleteBroadcast(job.youtube.broadcastId);
      log(id, 'Removed the YouTube broadcast.');
    } catch (err) {
      log(id, `Could not remove the YouTube broadcast: ${err.message}`);
    }
  }
}

export function stopJob(id) {
  if (!stopStream(id)) throw new Error('This stream is not running.');
  log(id, 'Stop requested.');
}

async function tick() {
  const now = Date.now();
  const { reminderMinutes } = getConfig().general;
  for (const job of listJobs()) {
    if (job.status !== 'scheduled') continue;
    const start = Date.parse(job.startAt);
    if (now - start > MISSED_AFTER_MS) {
      updateJob(job.id, { status: 'missed', error: 'The app was not running at the start time.' });
      log(job.id, 'Missed: the app was not running at the start time.');
      continue;
    }
    const needKeys = MANUAL_PLATFORMS.filter((p) => job.platforms[p] && !job.keys?.[p]?.key);
    if (!job.reminded && needKeys.length && now >= start - reminderMinutes * 60000 && now < start) {
      updateJob(job.id, { reminded: true });
      const names = needKeys.map((p) => NAMES[p]).join(' and ');
      const time = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      notify('Stream keys needed', `“${job.title}” starts at ${time}. Tap to paste your ${names} stream key.`, { click: jobLink(job.id) });
      openUrl(jobLink(job.id));
      log(job.id, `Reminder sent for ${names} keys.`);
    }
    if (now >= start) {
      startJob(job.id).catch((err) => log(job.id, `Start failed: ${err.message}`));
    }
  }
}

export function startScheduler(options = {}) {
  if (options.dashboardUrl) dashboardUrl = options.dashboardUrl;
  // If the app was closed in the middle of a stream, mark it as failed.
  for (const job of listJobs()) {
    if (['starting', 'live'].includes(job.status)) {
      updateJob(job.id, { status: 'failed', error: 'The app was closed while this stream was running.', keys: {} });
    }
  }
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (err) {
      console.error('Scheduler error:', err);
    } finally {
      busy = false;
    }
  };
  run();
  return setInterval(run, TICK_MS);
}
