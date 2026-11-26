import { ApiError, type Api, type CardResponse } from './controller';

/** HTTP client for the Chirp API. `base` is the API origin, e.g. https://chirp.example.app */
export function httpApi(base: string): Api {
  const call = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new ApiError(r.status, j.error ?? `request failed (${r.status})`);
    return j as T;
  };
  return {
    config: () => call<{ bot: string }>('/api/config'),
    createDevice: () => call('/api/devices', undefined, {}),
    me: (token) => call('/api/devices/me', token),
    heard: (token, frame, hw) => call<CardResponse>('/api/heard', token, { frame, hw }),
    act: (token, ref, action) => call<CardResponse>('/api/act', token, { ref, action }),
    sessionState: (token, id) => call<CardResponse>(`/api/sessions/${id}/state`, token),
    note: (token, ref, audio) => call<CardResponse>('/api/notes', token, { ref, audio }),
  };
}
