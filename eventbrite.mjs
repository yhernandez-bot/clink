// eventbrite.mjs — robusto con reintentos/timeout y fallback
async function fetchWithRetry(url, options = {}, { attempts = 3, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000)); // backoff
    }
  }
  throw lastErr;
}

export async function getTopCdmxEvent() {
  const token = process.env.EB_TOKEN;
  if (!token) {
    console.warn('EB_TOKEN no configurado');
    return null;
  }

  const params = new URLSearchParams({
    'location.address': 'Ciudad de México',
    'location.within': '40km',
    'start_date.range_start': new Date().toISOString(),
    'sort_by': 'date',
    'expand': 'venue',
    'page_size': '25',
    'include_unavailable_events': 'off'
  });

  const url = `https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`;

  try {
    const data = await fetchWithRetry(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      { attempts: 3, timeoutMs: 20000 }
    );

    const events = (data?.events || []).filter(e => e?.status === 'live');
    const e = events[0];
    if (!e) return null;

    const name = e.name?.text ?? 'Evento';
    const when = e.start?.local ? e.start.local.replace('T', ' ').slice(0, 16) : '';
    const venue = e.venue?.name ? `\n📍 ${e.venue.name}` : '';
    const urlEvent = e.url;

    return `🎶 Evento\n${name}${when ? ` — ${when}` : ''}${venue}\n🎟️ Info: ${urlEvent}`;
  } catch (err) {
    console.error('Eventbrite timeout/err:', err?.message || err);
    return null; // fallback: que el bot siga mandando las otras secciones
  }
}
