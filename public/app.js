const ALL_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'];
const NAMES = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
const STATUS = {
  scheduled: ['Scheduled', 'info'],
  starting: ['Starting…', 'warn'],
  live: ['Live', 'live'],
  done: ['Finished', 'ok'],
  failed: ['Failed', 'bad'],
  missed: ['Missed', 'bad'],
  canceled: ['Canceled', ''],
};
const PLAT_STATE = {
  pending: ['Setting up', 'warn'],
  ready: ['Ready', 'ok'],
  'needs-key': ['Needs key', 'warn'],
  live: ['Live', 'live'],
  done: ['Done', 'ok'],
  skipped: ['Skipped', 'bad'],
  error: ['Problem', 'bad'],
};

let state = null;
const openLogs = new Set();
const openKeyForms = new Set(); // "jobId:platform" for streams using a saved key but overriding it
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Small per-browser preferences (safe if storage is blocked).
const pref = {
  get(k) { try { return localStorage.getItem(`ms.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`ms.${k}`, v); } catch { /* ignore */ } },
};
let formProfileId = pref.get('formProfile');
let filterProfileId = pref.get('filterProfile') || 'all';
let settingsProfileId = pref.get('settingsProfile');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'x-app': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Please sign in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${bad ? ' bad' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 6000 : 3000);
}

/* ---------- tabs ---------- */
function route() {
  const hash = location.hash.slice(1) || 'streams';
  const tab = hash === 'settings' ? 'settings' : 'streams';
  for (const a of document.querySelectorAll('[data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('#view-streams').hidden = tab !== 'streams';
  $('#view-settings').hidden = tab !== 'settings';
  if (hash.startsWith('job-')) {
    const card = document.getElementById(hash);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
      card.querySelector('.key-form input[name="key"]')?.focus();
    }
  }
}
window.addEventListener('hashchange', route);

/* ---------- helpers ---------- */
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function formatWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function relative(iso) {
  const diff = Date.parse(iso) - Date.now();
  const m = Math.round(Math.abs(diff) / 60000);
  let text;
  if (m < 1) text = 'less than a minute';
  else if (m < 60) text = `${m} min`;
  else if (m < 60 * 24) text = `${Math.floor(m / 60)} h ${m % 60} min`;
  else text = `${Math.round(m / 1440)} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
function fmtSize(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const timeToSec = (t) => (t && /^\d+:\d+:\d+/.test(t) ? t.split(':').reduce((acc, v) => acc * 60 + Number(v), 0) : 0);
const visiblePlatforms = () => ALL_PLATFORMS.filter((p) => p !== 'tiktok' || state.general.showTiktok);
const profileById = (id) => state.profiles.find((p) => p.id === id) || state.profiles[0];
const profileTag = (p) => `<span class="tag" style="--c:${esc(p.color)}"><i></i>${esc(p.name)}</span>`;
const formProfile = () => profileById(formProfileId);

/* ---------- schedule form ---------- */
function renderProfilePicks() {
  if (!state.profiles.some((p) => p.id === formProfileId)) formProfileId = state.profiles[0]?.id;
  const box = $('#profile-picks');
  const html = state.profiles.map((p) => `<label style="--c:${esc(p.color)}"><input type="radio" name="profile" value="${p.id}" ${p.id === formProfileId ? 'checked' : ''}><span><i></i>${esc(p.name)}</span></label>`).join('');
  if (box.dataset.html !== html) {
    box.innerHTML = html;
    box.dataset.html = html;
  }
}
$('#profile-picks').addEventListener('change', (e) => {
  formProfileId = e.target.value;
  pref.set('formProfile', formProfileId);
  $('#profile-picks').dataset.html = '';
  renderProfilePicks();
  renderPicks(true);
  renderSource(true);
});

function renderPicks(reset = false) {
  const p = formProfile();
  const box = $('#platform-picks');
  const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
  const first = reset || !box.children.length;
  const info = {
    youtube: p.youtube.connected ? ['Automatic', p.youtube.channelTitle] : ['Not connected', ''],
    facebook: p.facebook.connected ? ['Automatic', p.facebook.pageName] : ['Not connected', ''],
    instagram: p.instagram.hasKey ? ['Automatic', 'saved key'] : ['Paste key per stream', ''],
    tiktok: ['Paste key per stream', ''],
  };
  const html = visiblePlatforms().map((k) => {
    const usable = k === 'youtube' ? p.youtube.connected : k === 'facebook' ? p.facebook.connected : true;
    const on = usable && (first ? true : checked.has(k));
    const [hint, detail] = info[k];
    return `<label class="pick"><input type="checkbox" value="${k}" ${on ? 'checked' : ''} ${usable ? '' : 'disabled'}>
      <span class="pf pf-${k}"></span><span>${NAMES[k]}<small>${esc(hint)}${detail ? ` · ${esc(detail)}` : ''}</small></span></label>`;
  }).join('');
  if (box.dataset.html !== html || reset) {
    box.innerHTML = html;
    box.dataset.html = html;
  }
}

function renderVideos() {
  const sel = $('#video-select');
  const current = sel.value;
  const html = state.videos.length
    ? state.videos.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${fmtSize(v.size)}</option>`).join('')
    : '<option value="">No videos yet. Upload one</option>';
  if (sel.dataset.html !== html) {
    sel.innerHTML = html;
    sel.dataset.html = html;
  }
  if (state.videos.some((v) => v.name === current)) sel.value = current;
  $('#delete-video').hidden = !state.videos.length;
  $('#local-folder-hint').hidden = state.hosted;
  $('#disk-hint').textContent = state.disk ? `${fmtSize(state.disk.free)} free on ${state.hosted ? 'the server' : 'this computer'}.` : '';
  $('#logout').hidden = !state.authEnabled;
}

/* ---------- OBS ---------- */
function renderSource(profileChanged = false) {
  const o = state.obs;
  $('#source-field').hidden = !(o.available && o.configured);
  $('#obs-form').hidden = !o.available;
  const form = $('#new-job');
  const useObs = o.configured && form.source.value === 'obs';
  $('#obs-scene-row').hidden = !useObs;
  $('#source-hint').textContent = useObs
    ? 'At the start time, OBS plays the video in a "Scheduled video" source in this scene (your overlays stay on top), goes live, and stops when the video ends. OBS must be open.'
    : 'The app plays the video and sends it straight to each platform. OBS isn\'t needed.';
  const sel = $('#obs-scene-select');
  const preferred = formProfile()?.obsScene || o.lastScene;
  const current = profileChanged ? preferred : sel.value || preferred;
  const options = o.scenes.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (sel.dataset.options !== options) {
    sel.innerHTML = options || '<option value="">No scenes. Click Refresh</option>';
    sel.dataset.options = options;
  }
  if (o.scenes.includes(current)) sel.value = current;
}
for (const r of document.querySelectorAll('input[name="source"]')) r.addEventListener('change', () => renderSource());
$('#obs-refresh').addEventListener('click', async () => {
  try {
    await api('POST', '/api/obs/refresh');
    toast('Scenes updated');
    await refresh();
  } catch (ex) { toast(ex.message, true); }
});
$('#obs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/settings/obs', { url: f.url.value, password: f.password.value });
    toast(`Connected to OBS ${r.version}. Found ${r.scenes.length} scene${r.scenes.length === 1 ? '' : 's'}.`);
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); } finally { btn.disabled = false; }
});
$('#obs-disconnect').addEventListener('click', async () => {
  if (!confirm('Disconnect OBS?')) return;
  await api('POST', '/api/settings/obs/disconnect').catch((ex) => toast(ex.message, true));
  await refresh(true, true);
});

/* ---------- videos ---------- */
$('#upload-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bar = $('#upload-progress');
  bar.hidden = false;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('x-app', '1');
  xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
  xhr.upload.onprogress = (ev) => ev.lengthComputable && (bar.firstElementChild.style.width = `${(ev.loaded / ev.total) * 100}%`);
  xhr.onload = async () => {
    bar.hidden = true;
    bar.firstElementChild.style.width = '0';
    e.target.value = '';
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status === 401) return (location.href = '/login');
    if (xhr.status >= 300) return toast(data.error || 'Upload failed', true);
    await refresh();
    $('#video-select').value = data.name;
    toast(`Uploaded ${data.name}`);
  };
  xhr.onerror = () => { bar.hidden = true; toast('Upload failed', true); };
  xhr.send(file);
});
$('#open-videos').addEventListener('click', () => {
  api('POST', '/api/open-videos-folder').catch((ex) => toast(ex.message, true));
});
$('#delete-video').addEventListener('click', async () => {
  const name = $('#video-select').value;
  if (!name) return;
  if (!confirm(`Delete “${name}” permanently? This can't be undone.`)) return;
  try {
    await api('DELETE', `/api/videos/${encodeURIComponent(name)}`);
    toast('Video deleted');
    await refresh();
  } catch (ex) { toast(ex.message, true); }
});
$('#logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'x-app': '1' } }).catch(() => {});
  location.href = '/login';
});

$('#new-job').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const err = $('#form-error');
  err.hidden = true;
  const platforms = Object.fromEntries([...form.querySelectorAll('#platform-picks input')].map((i) => [i.value, i.checked]));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Scheduling…';
  try {
    const job = await api('POST', '/api/jobs', {
      profileId: formProfileId,
      title: form.title.value,
      description: form.description.value,
      video: form.video.value,
      startAt: new Date(form.startAt.value).toISOString(),
      platforms,
      source: form.source.value,
      obsScene: form.obsScene.value,
    });
    form.title.value = '';
    form.description.value = '';
    toast(`Scheduled for ${formProfile().name}`);
    await refresh(true);
    location.hash = `job-${job.id}`;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Schedule stream';
  }
});

/* ---------- job cards ---------- */
function keyForm(job, p, url, saved) {
  return `<form class="key-form" data-job="${job.id}" data-platform="${p}" autocomplete="off">
    <input name="url" value="${esc(url)}" placeholder="Server URL (rtmp://…)" aria-label="${NAMES[p]} server URL">
    <input name="key" type="password" placeholder="${saved ? 'Saved. Paste to replace' : 'Stream key'}" aria-label="${NAMES[p]} stream key">
    <button class="btn small ${saved ? 'secondary' : 'primary'}">${saved ? 'Replace' : 'Save key'}</button>
  </form>`;
}

function platformRow(job, p) {
  const ps = job.platformStatus?.[p] || {};
  const [label, cls] = PLAT_STATE[ps.state] || ['', ''];
  let extra = '';
  if (p === 'youtube' && job.youtube?.watchUrl) {
    extra = ` · <a href="${esc(job.youtube.watchUrl)}" target="_blank" rel="noopener">Open on YouTube</a>`;
  }
  let form = '';
  if ((p === 'instagram' || p === 'tiktok') && ['scheduled', 'missed'].includes(job.status)) {
    const k = job.keys?.[p] || {};
    const profile = profileById(job.profileId);
    if (p === 'instagram' && k.usesProfileKey && !k.saved) {
      const id = `${job.id}:${p}`;
      form = openKeyForms.has(id)
        ? keyForm(job, p, profile.instagram.url, false)
        : `<button type="button" class="link small-link" data-action="override-key" data-id="${job.id}" data-platform="${p}">Use a different key for this stream</button>`;
    } else {
      const url = k.url || (p === 'instagram' ? profile.instagram.url : state.general.tiktokUrl) || '';
      form = keyForm(job, p, url, k.saved);
    }
  }
  return `<div class="plat">
    <div class="plat-name"><span class="pf pf-${p}"></span>${NAMES[p]}</div>
    <div class="plat-body">
      <div class="plat-status">${label ? `<span class="pill ${cls}">${label}</span>` : ''}<span>${esc(ps.message || '')}${extra}</span></div>
      ${form}
    </div>
  </div>`;
}

function jobCard(job) {
  const [label, cls] = STATUS[job.status] || [job.status, ''];
  const plats = ALL_PLATFORMS.filter((p) => job.platforms[p]);
  const upcoming = ['scheduled', 'missed'].includes(job.status);
  let live = '';
  if (job.status === 'live') {
    const done = timeToSec(job.progress?.time);
    const pct = job.durationSec ? Math.min(100, (done / job.durationSec) * 100) : 0;
    live = `<div class="job-live">
      <div class="progress"><div style="width:${pct}%"></div></div>
      <span>${job.progress?.time ? `${fmtDuration(done)} of ${fmtDuration(job.durationSec)} · speed ${esc(job.progress.speed || '-')}` : 'Connecting…'}</span>
    </div>`;
  }
  const actions = [];
  if (upcoming) actions.push(`<button class="btn small secondary" data-action="start" data-id="${job.id}">Start now</button>`);
  if (job.status === 'scheduled') actions.push(`<button class="btn small ghost" data-action="cancel" data-id="${job.id}">Cancel</button>`);
  if (job.status === 'live') actions.push(`<button class="btn small danger" data-action="stop" data-id="${job.id}">Stop stream</button>`);
  if (!['live', 'starting', 'scheduled'].includes(job.status)) actions.push(`<button class="btn small ghost" data-action="delete" data-id="${job.id}">Delete</button>`);
  const logOpen = openLogs.has(job.id);
  const profile = profileById(job.profileId);
  return `<article class="card job" id="job-${job.id}" style="--c:${esc(profile.color)}">
    <div class="job-head">
      <div>
        <div class="job-title-row">${profileTag(profile)}<p class="job-title">${esc(job.title)}</p></div>
        <div class="job-meta"><strong>${formatWhen(job.startAt)}</strong> · ${relative(job.startAt)} · ${esc(job.video)}${job.durationSec ? ` (${fmtDuration(job.durationSec)})` : ''}${job.source === 'obs' ? ` · via OBS scene “${esc(job.obsScene)}”` : ''}</div>
      </div>
      <span class="pill ${cls}">${label}</span>
    </div>
    ${live}
    ${job.error ? `<p class="error job-error">${esc(job.error)}</p>` : ''}
    <div class="plats">${plats.map((p) => platformRow(job, p)).join('')}</div>
    <div class="job-foot">
      ${actions.join('')}
      <span class="spacer"></span>
      <button class="btn small ghost" data-action="log" data-id="${job.id}">${logOpen ? 'Hide log' : 'Show log'}</button>
    </div>
    ${logOpen ? `<pre class="log" data-log="${job.id}">Loading…</pre>` : ''}
  </article>`;
}

function renderFilter() {
  if (filterProfileId !== 'all' && !state.profiles.some((p) => p.id === filterProfileId)) filterProfileId = 'all';
  const chips = [{ id: 'all', name: 'All profiles', color: '' }, ...state.profiles];
  const html = chips.map((p) => `<button type="button" class="chip" role="radio" aria-checked="${p.id === filterProfileId}" data-filter="${p.id}" ${p.color ? `style="--c:${esc(p.color)}"` : ''}>${p.color ? '<i></i>' : ''}${esc(p.name)}</button>`).join('');
  const box = $('#profile-filter');
  if (box.dataset.html !== html) {
    box.innerHTML = html;
    box.dataset.html = html;
  }
}
$('#profile-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  filterProfileId = chip.dataset.filter;
  pref.set('filterProfile', filterProfileId);
  renderFilter();
  renderJobs(true);
});

function userIsTyping() {
  const active = document.activeElement;
  if (active?.closest('.jobs') && active.matches('input')) return true;
  return [...document.querySelectorAll('.key-form input[name="key"]')].some((i) => i.value);
}

function renderJobs(force = false) {
  if (!force && userIsTyping()) return;
  const jobs = state.jobs.filter((j) => filterProfileId === 'all' || j.profileId === filterProfileId);
  const upcoming = jobs.filter((j) => ['scheduled', 'starting', 'live', 'missed'].includes(j.status))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const history = jobs.filter((j) => !upcoming.includes(j))
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)).slice(0, 30);
  const who = filterProfileId === 'all' ? '' : ` for ${profileById(filterProfileId).name}`;
  $('#jobs-upcoming').innerHTML = upcoming.length ? upcoming.map(jobCard).join('') : `<div class="empty">Nothing scheduled${who} yet. Pick a video and a time to get started.</div>`;
  $('#jobs-history').innerHTML = history.length ? history.map(jobCard).join('') : `<div class="empty">Finished streams${who} show up here.</div>`;
  for (const id of openLogs) loadLog(id);
}

async function loadLog(id) {
  const pre = document.querySelector(`[data-log="${id}"]`);
  if (!pre) return;
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  const text = await fetch(`/api/jobs/${id}/log`).then((r) => r.text()).catch(() => '');
  pre.textContent = text.trim() || 'No log yet.';
  if (atBottom || pre.dataset.loaded !== '1') pre.scrollTop = pre.scrollHeight;
  pre.dataset.loaded = '1';
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('.key-form');
  if (!form) return;
  e.preventDefault();
  try {
    await api('POST', `/api/jobs/${form.dataset.job}/keys`, { platform: form.dataset.platform, url: form.url.value, key: form.key.value });
    form.key.value = '';
    openKeyForms.delete(`${form.dataset.job}:${form.dataset.platform}`);
    document.activeElement?.blur();
    toast(`${NAMES[form.dataset.platform]} key saved for this stream`);
    await refresh(true);
  } catch (ex) { toast(ex.message, true); }
});

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText($(copy.dataset.copy).value).catch(() => {});
    return toast('Copied');
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  const job = state.jobs.find((j) => j.id === id);
  try {
    if (action === 'log') {
      openLogs.has(id) ? openLogs.delete(id) : openLogs.add(id);
      return renderJobs(true);
    }
    if (action === 'override-key') {
      openKeyForms.add(`${id}:${btn.dataset.platform}`);
      renderJobs(true);
      return document.querySelector(`#job-${id} .key-form input[name="key"]`)?.focus();
    }
    if (action === 'start' && !confirm(`Start “${job.title}” now?`)) return;
    if (action === 'cancel' && !confirm(`Cancel “${job.title}”? The YouTube broadcast will be removed too.`)) return;
    if (action === 'stop' && !confirm(`Stop “${job.title}” on every platform now?`)) return;
    if (action === 'delete' && !confirm(`Delete “${job.title}” from the list? The video file stays.`)) return;
    btn.disabled = true;
    if (action === 'delete') await api('DELETE', `/api/jobs/${id}`);
    else await api('POST', `/api/jobs/${id}/${action}`);
    await refresh(true);
  } catch (ex) {
    toast(ex.message, true);
    btn.disabled = false;
  }
});

/* ---------- settings: profiles ---------- */
const settingsProfile = () => profileById(settingsProfileId);

function renderProfileTabs() {
  if (!state.profiles.some((p) => p.id === settingsProfileId)) settingsProfileId = state.profiles[0]?.id;
  const html = state.profiles.map((p) => {
    const ok = p.youtube.connected || p.facebook.connected || p.instagram.hasKey;
    return `<button type="button" role="tab" class="ptab" style="--c:${esc(p.color)}" aria-selected="${p.id === settingsProfileId}" data-profile="${p.id}"><i></i>${esc(p.name)}${ok ? '' : ' <span class="badge-dot" title="Not set up yet"></span>'}</button>`;
  }).join('');
  const box = $('#profile-tabs');
  if (box.dataset.html !== html) {
    box.innerHTML = html;
    box.dataset.html = html;
  }
}

function setStatus(sel, ok, text) {
  const pill = $(`${sel} [data-status]`);
  pill.className = `pill ${ok ? 'ok' : 'warn'}`;
  pill.textContent = text;
}

function renderProfileStatus() {
  const p = settingsProfile();
  if (!p) return;
  setStatus('#p-yt', p.youtube.connected, p.youtube.connected ? `Connected${p.youtube.channelTitle ? `: ${p.youtube.channelTitle}` : ''}` : 'Not connected');
  $('#p-yt-disconnect').hidden = !p.youtube.connected;
  $('#p-yt-connect').textContent = p.youtube.connected ? 'Reconnect' : 'Connect YouTube';
  const hasClient = state.youtubeClient.clientId && state.youtubeClient.hasSecret;
  $('#p-yt-connect').disabled = !hasClient;
  $('#p-yt-client-hint').hidden = hasClient;
  setStatus('#p-fb', p.facebook.connected, p.facebook.connected ? `Connected${p.facebook.pageName ? `: ${p.facebook.pageName}` : ''}` : 'Not connected');
  $('#p-fb-disconnect').hidden = !p.facebook.connected;
  setStatus('#p-ig', p.instagram.hasKey, p.instagram.hasKey ? 'Key saved' : 'No key');
  $('#p-ig-clear').hidden = !p.instagram.hasKey;
  $('#profile-delete').hidden = state.profiles.length <= 1;
}

function fillProfileForms() {
  const p = settingsProfile();
  if (!p) return;
  $('#profile-name-form').name.value = p.name;
  $('#p-yt-privacy').value = p.youtube.privacy;
  const fb = $('#p-fb');
  fb.pageId.value = p.facebook.pageId;
  fb.pageToken.value = '';
  fb.pageToken.placeholder = p.facebook.connected ? 'Saved. Paste to replace' : '';
  const ig = $('#p-ig');
  ig.url.value = p.instagram.url;
  ig.key.value = '';
  ig.key.placeholder = p.instagram.hasKey ? 'Saved. Paste to replace' : '';
}

$('#profile-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-profile]');
  if (!tab) return;
  settingsProfileId = tab.dataset.profile;
  pref.set('settingsProfile', settingsProfileId);
  renderProfileTabs();
  renderProfileStatus();
  fillProfileForms();
});
$('#profile-add').addEventListener('click', async () => {
  const name = prompt('Name for the new profile (for example the podcast or brand name):');
  if (!name) return;
  try {
    const p = await api('POST', '/api/profiles', { name });
    settingsProfileId = p.id;
    toast(`Added ${p.name}`);
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#profile-name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', `/api/profiles/${settingsProfileId}`, { name: e.target.name.value });
    toast('Renamed');
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#profile-delete').addEventListener('click', async () => {
  const p = settingsProfile();
  if (!confirm(`Delete the ${p.name} profile and its saved connections? Past streams stay in History.`)) return;
  try {
    await api('DELETE', `/api/profiles/${p.id}`);
    settingsProfileId = null;
    toast(`Deleted ${p.name}`);
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#p-yt-privacy').addEventListener('change', async (e) => {
  try {
    await api('POST', `/api/profiles/${settingsProfileId}`, { youtubePrivacy: e.target.value });
    toast('Saved');
    await refresh();
  } catch (ex) { toast(ex.message, true); }
});
$('#p-yt-connect').addEventListener('click', () => {
  // Google doesn't allow sign-in inside app windows, so this opens your normal browser.
  window.open(`/auth/youtube?profile=${encodeURIComponent(settingsProfileId)}`, '_blank');
  toast(`Sign in with ${settingsProfile().name}'s Google account in your browser. This page updates by itself.`);
});
$('#p-yt-disconnect').addEventListener('click', async () => {
  if (!confirm(`Disconnect YouTube for ${settingsProfile().name}?`)) return;
  await api('POST', `/api/profiles/${settingsProfileId}/youtube/disconnect`).catch((ex) => toast(ex.message, true));
  await refresh(true, true);
});
$('#p-fb').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await api('POST', `/api/profiles/${settingsProfileId}/facebook`, { pageId: f.pageId.value, pageToken: f.pageToken.value });
    toast(`Connected to ${r.pageName || 'the Page'}`);
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); } finally { btn.disabled = false; }
});
$('#p-fb-disconnect').addEventListener('click', async () => {
  if (!confirm(`Disconnect the Facebook Page for ${settingsProfile().name}?`)) return;
  await api('POST', `/api/profiles/${settingsProfileId}/facebook/disconnect`).catch((ex) => toast(ex.message, true));
  await refresh(true, true);
});
$('#p-ig').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('POST', `/api/profiles/${settingsProfileId}/instagram`, { url: f.url.value, key: f.key.value });
    toast(`Instagram key saved for ${settingsProfile().name}`);
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#p-ig-clear').addEventListener('click', async () => {
  if (!confirm(`Remove ${settingsProfile().name}'s saved Instagram key?`)) return;
  await api('POST', `/api/profiles/${settingsProfileId}/instagram/clear`).catch((ex) => toast(ex.message, true));
  await refresh(true, true);
});

/* ---------- settings: shared ---------- */
function fillSettings() {
  const yt = $('#yt-form');
  yt.clientId.value = state.youtubeClient.clientId;
  yt.clientSecret.value = '';
  yt.clientSecret.placeholder = state.youtubeClient.hasSecret ? 'Saved. Paste to replace' : '';
  $('#yt-redirect').value = state.youtubeClient.redirectUri;
  const g = $('#general-form');
  g.reminderMinutes.value = state.general.reminderMinutes;
  g.videoBitrateKbps.value = state.general.videoBitrateKbps;
  g.showTiktok.checked = state.general.showTiktok;
  g.tiktokUrl.value = state.general.tiktokUrl;
  $('#tiktok-url-field').hidden = !state.general.showTiktok;
  updateBandwidthHint();
  const of = $('#obs-form');
  of.url.value = state.obs.url;
  of.password.value = '';
  of.password.placeholder = state.obs.hasPassword ? 'Saved. Paste to replace' : '';
  $('#dock-url').textContent = location.origin;
  const n = $('#notify-form');
  n.ntfyTopic.value = state.general.ntfyTopic || '';
  n.ntfyServer.value = state.general.ntfyServer || 'https://ntfy.sh';
  fillProfileForms();
}

function renderSettingsStatus() {
  const c = state.youtubeClient;
  const cPill = $('#yt-client-status');
  cPill.className = `pill ${c.clientId && c.hasSecret ? 'ok' : 'warn'}`;
  cPill.textContent = c.clientId && c.hasSecret ? 'Saved' : 'Not set';
  const oPill = $('#obs-status');
  oPill.className = `pill ${state.obs.configured ? 'ok' : ''}`;
  oPill.textContent = state.obs.configured ? `Connected${state.obs.version ? `: OBS ${state.obs.version}` : ''}` : 'Not connected';
  $('#obs-disconnect').hidden = !state.obs.configured;
  const nPill = $('#notify-status');
  nPill.className = `pill ${state.general.ntfyTopic ? 'ok' : 'warn'}`;
  nPill.textContent = state.general.ntfyTopic ? 'On' : 'Off';
  const notSetUp = state.profiles.filter((p) => !(p.youtube.connected || p.facebook.connected || p.instagram.hasKey)).length;
  $('#settings-badge').hidden = !notSetUp;
  $('#settings-badge').textContent = notSetUp;
  renderProfileTabs();
  renderProfileStatus();
}

function updateBandwidthHint() {
  const g = $('#general-form');
  const kbps = Number(g.videoBitrateKbps.value) || 4500;
  const count = g.showTiktok.checked ? 4 : 3;
  const mbps = ((kbps + 128) * count * 1.1) / 1000;
  $('#bandwidth-hint').textContent = `Streaming to all ${count} platforms at this bitrate needs about ${mbps.toFixed(0)} Mbps of upload speed.`;
}
$('#general-form').videoBitrateKbps.addEventListener('input', updateBandwidthHint);
$('#general-form').showTiktok.addEventListener('change', (e) => {
  $('#tiktok-url-field').hidden = !e.target.checked;
  updateBandwidthHint();
});

$('#yt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('POST', '/api/settings/youtube', { clientId: f.clientId.value, clientSecret: f.clientSecret.value });
    toast('Google OAuth client saved');
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#general-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('POST', '/api/settings/general', {
      reminderMinutes: f.reminderMinutes.value,
      videoBitrateKbps: f.videoBitrateKbps.value,
      showTiktok: f.showTiktok.checked,
      tiktokUrl: f.tiktokUrl.value,
    });
    toast('Saved');
    await refresh(true, true);
    renderPicks(true);
  } catch (ex) { toast(ex.message, true); }
});

function randomTopic() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `streams-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18)}`;
}
$('#ntfy-generate').addEventListener('click', () => { $('#notify-form').ntfyTopic.value = randomTopic(); });
async function saveNotify() {
  const f = $('#notify-form');
  await api('POST', '/api/settings/notifications', { ntfyTopic: f.ntfyTopic.value, ntfyServer: f.ntfyServer.value });
}
$('#notify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveNotify();
    toast('Saved');
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});
$('#ntfy-test').addEventListener('click', async () => {
  try {
    await saveNotify();
    await api('POST', '/api/settings/notifications/test');
    toast('Test sent. Check your phone.');
    await refresh(true, true);
  } catch (ex) { toast(ex.message, true); }
});

/* ---------- main loop ---------- */
async function refresh(forceJobs = false, refillSettings = false) {
  try {
    state = await api('GET', '/api/state');
  } catch {
    return toast('Cannot reach the app. Is it still running?', true);
  }
  renderProfilePicks();
  renderVideos();
  renderPicks();
  renderSource();
  renderFilter();
  renderJobs(forceJobs);
  renderSettingsStatus();
  if (refillSettings) fillSettings();
}

(async function init() {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  $('#new-job').startAt.value = toLocalInput(next);
  await refresh(true, true);
  renderSource(true);
  route();
  setInterval(() => refresh(), 3000);
})();
