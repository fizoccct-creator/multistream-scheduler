// Notifications: phone push through ntfy (if set up), plus desktop notifications when running locally.
// The desktop app replaces the local parts with native versions via setNotifier / setOpener.
import { execFile } from 'node:child_process';
import { getConfig } from './store.js';

let notifier = null;
let opener = null;

export const setNotifier = (fn) => { notifier = fn; };
export const setOpener = (fn) => { opener = fn; };

const hosted = () => Boolean(process.env.MS_HOSTED);
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ntfy (https://ntfy.sh): free push notifications to the ntfy phone app, no account needed.
async function sendNtfy(title, message, click) {
  const { ntfyServer, ntfyTopic } = getConfig().general;
  if (!ntfyTopic) return false;
  const res = await fetch(ntfyServer || 'https://ntfy.sh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: ntfyTopic, title, message, click, tags: ['red_circle'], priority: 4 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ntfy returned HTTP ${res.status}`);
  return true;
}

// opts.click: link opened when you tap the notification. opts.strict: throw if sending fails.
export async function notify(title, message, opts = {}) {
  console.log(`[notify] ${title}: ${message}`);
  if (process.env.NO_NOTIFY) return;
  try {
    await sendNtfy(title, message, opts.click);
  } catch (err) {
    console.error(`[notify] ntfy failed: ${err.message}`);
    if (opts.strict) throw err;
  }
  if (hosted()) return;
  if (notifier) return notifier(title, message);
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"`], () => {});
  }
}

// Show the dashboard (optionally at a #hash such as #job-abc123). Does nothing on a server.
export function openUrl(url) {
  if (process.env.NO_NOTIFY || hosted()) return;
  if (opener) return opener(url);
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [url], () => {});
}

export function openFolder(dir) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [dir], () => {});
}
