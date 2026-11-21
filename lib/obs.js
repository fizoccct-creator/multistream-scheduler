// Controls OBS Studio through its built-in WebSocket server (OBS 28 or newer, protocol v5).
// Turn it on in OBS: Tools → WebSocket Server Settings → Enable WebSocket server.
import crypto from 'node:crypto';
import { getConfig } from './store.js';

export const MEDIA_INPUT_NAME = 'Scheduled video';
const EVENTS_OUTPUTS = 1 << 6;
const EVENTS_MEDIA = 1 << 8;
const NOT_REACHABLE = 'Could not reach OBS. Is OBS open, with Tools → WebSocket Server Settings → "Enable WebSocket server" turned on?';

const sha256b64 = (s) => crypto.createHash('sha256').update(s).digest('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const isConfigured = () => Boolean(getConfig().obs.url);

export async function connect({ url, password } = getConfig().obs, eventSubscriptions = 0) {
  if (typeof WebSocket === 'undefined') throw new Error('This version of Node.js has no WebSocket support. Use Node 22 or newer.');
  const ws = new WebSocket(url || 'ws://127.0.0.1:4455', 'obswebsocket.json');
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;

  const client = {
    closed: false,
    onClose: null,
    request(requestType, requestData = {}) {
      if (client.closed) return Promise.reject(new Error('Lost connection to OBS.'));
      const requestId = String(nextId++);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`OBS did not answer (${requestType}).`));
        }, 15000);
        pending.set(requestId, {
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      });
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      try { ws.close(); } catch { /* already closed */ }
    },
  };

  await new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer);
      reject(new Error(message));
      client.close();
    };
    const timer = setTimeout(() => fail(NOT_REACHABLE), 6000);
    ws.addEventListener('error', () => fail(NOT_REACHABLE));
    ws.addEventListener('close', (e) => {
      client.closed = true;
      if (e.code === 4009) fail('Wrong OBS WebSocket password. Copy it from Tools → WebSocket Server Settings → Show Connect Info.');
      else fail(NOT_REACHABLE);
      for (const p of pending.values()) p.reject(new Error('Lost connection to OBS.'));
      pending.clear();
      client.onClose?.();
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const { op, d } = msg;
      if (op === 0) {
        const identify = { rpcVersion: 1, eventSubscriptions };
        if (d.authentication) {
          if (!password) return fail('OBS needs a WebSocket password. Copy it from Tools → WebSocket Server Settings → Show Connect Info.');
          identify.authentication = sha256b64(sha256b64(password + d.authentication.salt) + d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (op === 2) {
        clearTimeout(timer);
        resolve();
      } else if (op === 7) {
        const p = pending.get(d.requestId);
        if (!p) return;
        pending.delete(d.requestId);
        if (d.requestStatus?.result) p.resolve(d.responseData || {});
        else p.reject(new Error(`OBS: ${d.requestStatus?.comment || `request failed (code ${d.requestStatus?.code})`}`));
      } else if (op === 5) {
        for (const fn of listeners) fn(d.eventType, d.eventData || {});
      }
    });
  });
  return client;
}

// Quick check for the Settings page: version and scene names.
export async function getInfo(settings) {
  const obs = await connect(settings);
  try {
    const version = await obs.request('GetVersion');
    const { scenes } = await obs.request('GetSceneList');
    return { version: version.obsVersion, scenes: scenes.map((s) => s.sceneName).reverse() };
  } finally {
    obs.close();
  }
}

// Put the video into a "Scheduled video" media source in the scene, filling the canvas, behind your overlays.
async function setupMediaSource(obs, scene, file) {
  const settings = {
    local_file: file,
    is_local_file: true,
    looping: false,
    restart_on_activate: true,
    close_when_inactive: true,
    clear_on_media_end: true,
  };
  const { inputs } = await obs.request('GetInputList');
  let isNew = false;
  if (inputs.some((i) => i.inputName === MEDIA_INPUT_NAME)) {
    await obs.request('SetInputSettings', { inputName: MEDIA_INPUT_NAME, inputSettings: settings, overlay: true });
  } else {
    // CreateInput also adds it to the scene.
    await obs.request('CreateInput', { sceneName: scene, inputName: MEDIA_INPUT_NAME, inputKind: 'ffmpeg_source', inputSettings: settings });
    isNew = true;
  }

  const { sceneItems } = await obs.request('GetSceneItemList', { sceneName: scene });
  let item = sceneItems.find((i) => i.sourceName === MEDIA_INPUT_NAME);
  if (!item) {
    isNew = true;
    const { sceneItemId } = await obs.request('CreateSceneItem', { sceneName: scene, sourceName: MEDIA_INPUT_NAME });
    item = { sceneItemId };
  }
  await obs.request('SetSceneItemEnabled', { sceneName: scene, sceneItemId: item.sceneItemId, sceneItemEnabled: true });
  // Only size and place it the first time, so any changes you make in OBS are kept.
  if (isNew) {
    const { baseWidth, baseHeight } = await obs.request('GetVideoSettings');
    await obs.request('SetSceneItemTransform', {
      sceneName: scene,
      sceneItemId: item.sceneItemId,
      sceneItemTransform: {
        positionX: 0, positionY: 0, alignment: 5, // top-left
        boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: baseWidth, boundsHeight: baseHeight,
      },
    });
    await obs.request('SetSceneItemIndex', { sceneName: scene, sceneItemId: item.sceneItemId, sceneItemIndex: 0 });
  }
}

async function waitForStream(obs, active, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { outputActive } = await obs.request('GetStreamStatus');
    if (outputActive === active) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Runs one scheduled stream in OBS:
 * loads the video, switches to the scene, points OBS's stream at our local relay and starts streaming.
 * Your own OBS stream settings are saved first and put back by restore().
 */
export async function startSession({ scene, file, relayServer, relayKey, log, onMediaEnded, onStreamStopped }) {
  const obs = await connect(getConfig().obs, EVENTS_OUTPUTS | EVENTS_MEDIA);
  let previousService = null;
  let restored = false;

  const restore = async () => {
    if (restored || !previousService) return obs.close();
    restored = true;
    for (let i = 0; i < 20; i++) {
      try {
        if (!(await waitForStream(obs, false, 1000))) continue;
        await obs.request('SetStreamServiceSettings', previousService);
        log('Put your own OBS stream settings back.');
        break;
      } catch (err) {
        if (obs.closed) {
          log(`Could not put your OBS stream settings back (${err.message}). Check Settings → Stream in OBS.`);
          break;
        }
        await sleep(1000);
      }
    }
    obs.close();
  };

  try {
    const status = await obs.request('GetStreamStatus');
    if (status.outputActive) throw new Error('OBS is already streaming. Stop that stream first.');
    const { scenes } = await obs.request('GetSceneList');
    if (!scenes.some((s) => s.sceneName === scene)) throw new Error(`The OBS scene "${scene}" no longer exists.`);

    await setupMediaSource(obs, scene, file);
    await obs.request('SetCurrentProgramScene', { sceneName: scene });
    log(`OBS: loaded the video into "${MEDIA_INPUT_NAME}" and switched to scene "${scene}".`);

    const current = await obs.request('GetStreamServiceSettings');
    previousService = { streamServiceType: current.streamServiceType, streamServiceSettings: current.streamServiceSettings };
    await obs.request('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: relayServer, key: relayKey, use_auth: false },
    });

    obs.onEvent((type, data) => {
      if (type === 'MediaInputPlaybackEnded' && data.inputName === MEDIA_INPUT_NAME) onMediaEnded?.();
      if (type === 'StreamStateChanged' && data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') onStreamStopped?.();
    });

    await obs.request('StartStream');
    if (!(await waitForStream(obs, true))) throw new Error('OBS did not start streaming. Check OBS for an error message.');
    await obs.request('TriggerMediaInputAction', { inputName: MEDIA_INPUT_NAME, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' });
    log('OBS is streaming. The video started from the beginning.');
  } catch (err) {
    await restore();
    throw err;
  }

  return {
    stopStream: () => obs.request('StopStream').catch(() => {}),
    restore,
  };
}
