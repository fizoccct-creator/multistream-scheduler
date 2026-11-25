// YouTube Data API v3: sign-in plus scheduled broadcasts that start by themselves.
// The OAuth client (Client ID/secret) is shared; each profile signs in to its own channel.
import { getConfig, updateProfile } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const API = 'https://www.googleapis.com/youtube/v3';
const cached = new Map(); // profile id -> { token, expires }

export const hasClient = () => Boolean(getConfig().youtube.clientId && getConfig().youtube.clientSecret);
export const isConnected = (profile) => Boolean(profile?.youtube?.refreshToken);

export function authUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: getConfig().youtube.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = getConfig().youtube;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

export async function exchangeCode(profile, code, redirectUri) {
  const data = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions, then connect again.');
  }
  cached.set(profile.id, { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  updateProfile(profile.id, { youtube: { refreshToken: data.refresh_token } });
  try {
    const channels = await api(profile, 'GET', 'channels', { part: 'snippet', mine: 'true' });
    updateProfile(profile.id, { youtube: { channelTitle: channels.items?.[0]?.snippet?.title || '' } });
  } catch {
    // The channel name is only for display.
  }
}

async function accessToken(profile) {
  const c = cached.get(profile.id);
  if (c && Date.now() < c.expires) return c.token;
  const { refreshToken } = profile.youtube || {};
  if (!refreshToken) throw new Error(`YouTube is not connected for ${profile.name}.`);
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  cached.set(profile.id, { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

export function disconnect(profile) {
  cached.delete(profile.id);
  updateProfile(profile.id, { youtube: { refreshToken: '', channelTitle: '' } });
}

async function api(profile, method, resource, query = {}, body) {
  const token = await accessToken(profile);
  const res = await fetch(`${API}/${resource}?${new URLSearchParams(query)}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube: ${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

// Creates a broadcast with auto-start and auto-stop, plus a stream to send video to.
export async function createBroadcast(profile, { title, description, startAt }) {
  const { privacy } = profile.youtube;
  const start = new Date(Math.max(Date.parse(startAt), Date.now() + 5000));
  const broadcast = await api(profile, 'POST', 'liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
    snippet: { title: title.slice(0, 100), description: (description || '').slice(0, 5000), scheduledStartTime: start.toISOString() },
    status: { privacyStatus: privacy || 'public', selfDeclaredMadeForKids: false },
    contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true },
  });
  const stream = await api(profile, 'POST', 'liveStreams', { part: 'snippet,cdn,contentDetails' }, {
    snippet: { title: `${title.slice(0, 90)} (stream)` },
    cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
    contentDetails: { isReusable: false },
  });
  await api(profile, 'POST', 'liveBroadcasts/bind', { id: broadcast.id, part: 'id,contentDetails', streamId: stream.id });
  const info = stream.cdn.ingestionInfo;
  const base = info.rtmpsIngestionAddress || info.ingestionAddress;
  return {
    broadcastId: broadcast.id,
    streamId: stream.id,
    ingestUrl: `${base}/${info.streamName}`,
    watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
  };
}

export async function deleteBroadcast(profile, id) {
  await api(profile, 'DELETE', 'liveBroadcasts', { id });
}
