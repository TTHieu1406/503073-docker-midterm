const listeners = new Set();

/** Lets the footer display which replica answered the latest request. */
export function onServedBy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const servedBy = response.headers.get('X-Served-By');
  if (servedBy) {
    const version = response.headers.get('X-App-Version');
    for (const listener of listeners) listener({ servedBy, version });
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}
