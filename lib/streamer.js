// Plays a video file in real time and sends it to every platform at once with FFmpeg.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';

const running = new Map(); // job id -> { proc, stopped, progress, failed }

// The desktop app ships its own FFmpeg and sets FFMPEG_PATH; otherwise use the one on PATH.
const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';

// Read duration and tracks with `ffmpeg -i` (it exits with an error because there's no output; that's expected).
export function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG(), ['-hide_banner', '-i', file], { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new Error('FFmpeg was not found.'));
      if (!/Input #0/.test(stderr)) return reject(new Error('FFmpeg could not read this video file.'));
      const d = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve({
        duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
        hasVideo: /Stream #\d+:\d+.*?: Video:/.test(stderr),
        hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(stderr),
      });
    });
  });
}

// The tee muxer treats | [ ] \ and ' as special characters.
const teeEscape = (s) => s.replace(/[\\|[\]']/g, (m) => `\\${m}`);

function parseStats(line) {
  const pick = (name) => line.match(new RegExp(`${name}=\\s*(\\S+)`))?.[1] || null;
  return { time: pick('time'), speed: pick('speed'), bitrate: pick('bitrate'), at: Date.now() };
}

export function buildArgs({ file, hasAudio, outputs, bitrateKbps = 4500 }) {
  // Keep the longer side at most 1920 px and both sides even. Works for landscape and vertical video.
  const scale =
    "scale='if(gt(iw,ih),min(1920,trunc(iw/2)*2),-2)':'if(gt(iw,ih),-2,min(1920,trunc(ih/2)*2))',fps=30,format=yuv420p";
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-stats', '-re', '-i', file];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push(
    '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
    '-b:v', `${bitrateKbps}k`, '-maxrate', `${bitrateKbps}k`, '-bufsize', `${bitrateKbps * 2}k`,
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-flags', '+global_header',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
  );
  if (!hasAudio) args.push('-shortest');
  // onfail=ignore: if one platform drops, the others keep streaming.
  const tee = outputs.map((o) => `[f=flv:onfail=ignore:flvflags=no_duration_filesize]${teeEscape(o.url)}`).join('|');
  args.push('-f', 'tee', tee);
  return args;
}

export async function startStream({ id, file, outputs, logFile, bitrateKbps, onExit }) {
  const { hasAudio } = await probe(file);
  const args = buildArgs({ file, hasAudio, outputs, bitrateKbps });
  const secrets = outputs.map((o) => o.url.split('/').pop()).filter((s) => s.length > 6);
  const redact = (line) => secrets.reduce((acc, s) => acc.replaceAll(s, '[key hidden]'), line);

  const log = fs.createWriteStream(logFile, { flags: 'a' });
  log.write(`[${new Date().toLocaleString()}] FFmpeg started. Sending to: ${outputs.map((o) => o.platform).join(', ')}\n`);

  const proc = spawn(FFMPEG(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const entry = { proc, stopped: false, progress: null, failed: new Set() };
  running.set(id, entry);

  let buf = '';
  let lastStatsWrite = 0;
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r\n|\r|\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      if (/^\s*(frame|size)=/.test(line)) {
        entry.progress = parseStats(line);
        if (Date.now() - lastStatsWrite > 30000) {
          log.write(`${line.trim()}\n`);
          lastStatsWrite = Date.now();
        }
        continue;
      }
      const failed = line.match(/Slave muxer #(\d+) failed/);
      if (failed) entry.failed.add(Number(failed[1]));
      log.write(`${redact(line)}\n`);
    }
  });

  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    running.delete(id);
    log.write(`[${new Date().toLocaleString()}] FFmpeg ended (${result.error ? result.error : `exit code ${result.code}`}).\n`);
    log.end();
    const failedPlatforms = [...entry.failed].map((i) => outputs[i]?.platform).filter(Boolean);
    onExit({ ...result, stopped: entry.stopped, failedPlatforms });
  };
  proc.on('error', (err) => finish({ code: -1, error: err.code === 'ENOENT' ? 'FFmpeg is not installed' : err.message }));
  proc.on('close', (code) => finish({ code }));
}

export function stopStream(id) {
  const entry = running.get(id);
  if (!entry) return false;
  entry.stopped = true;
  entry.proc.kill('SIGINT');
  setTimeout(() => running.has(id) && entry.proc.kill('SIGKILL'), 10000);
  return true;
}

export const getProgress = (id) => running.get(id)?.progress || null;

export function stopAll() {
  for (const id of running.keys()) stopStream(id);
}
