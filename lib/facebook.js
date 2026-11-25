// Facebook Live Video API for a Facebook Page. Each profile has its own Page.

// Meta retires Graph API versions about two years after release.
// If Facebook says this version is no longer supported, raise the number.
const GRAPH = 'https://graph.facebook.com/v24.0';

async function graph(method, endpoint, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${GRAPH}/${endpoint}?${body}` : `${GRAPH}/${endpoint}`;
  const res = await fetch(url, method === 'GET' ? {} : { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Facebook: ${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

export function isConnected(profile) {
  const { pageId, pageToken } = profile?.facebook || {};
  return Boolean(pageId && pageToken);
}

export async function verify(pageId, pageToken) {
  return graph('GET', pageId, { fields: 'name' }, pageToken);
}

// status=LIVE_NOW: the Page goes live as soon as video starts arriving.
export async function createLiveVideo(profile, { title, description }) {
  const { pageId, pageToken } = profile.facebook;
  const data = await graph('POST', `${pageId}/live_videos`, {
    status: 'LIVE_NOW',
    title,
    description: description || title,
  }, pageToken);
  const ingestUrl = data.secure_stream_url || data.stream_url;
  if (!ingestUrl) throw new Error('Facebook did not return a stream URL.');
  return { liveVideoId: data.id, ingestUrl };
}

export async function endLiveVideo(profile, id) {
  await graph('POST', id, { end_live_video: 'true' }, profile.facebook.pageToken);
}
