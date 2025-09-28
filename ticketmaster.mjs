import fetch from 'node-fetch';

export async function getTopTicketmasterEvents() {
  const apiKey = process.env.TM_API_KEY;
  if (!apiKey) {
    console.error('[Ticketmaster] TM_API_KEY no configurada');
    return [];
  }

  try {
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${apiKey}&locale=es-mx&countryCode=MX&city=Mexico%20City&size=50&sort=date,asc`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data._embedded || !data._embedded.events) {
      console.log('[Ticketmaster] Sin eventos encontrados');
      return [];
    }

    // Agrupa por nombre y junta todas las fechas/horas
    const eventosMap = new Map();

    for (const ev of data._embedded.events) {
      const fecha = ev.dates?.start?.localDate || '';
      const hora  = ev.dates?.start?.localTime || '';
      const fechaHora = fecha + (hora ? ` ${hora}` : '');

      const key = (ev.name || '').trim().toLowerCase();
      if (!key) continue;

      if (!eventosMap.has(key)) {
        eventosMap.set(key, {
          name: ev.name,
          url: ev.url,
          venue: ev._embedded?.venues?.[0]?.name || 'Lugar por confirmar',
          fechas: []
        });
      }
      eventosMap.get(key).fechas.push(fechaHora);
    }

    return Array.from(eventosMap.values());
  } catch (err) {
    console.error('[Ticketmaster] Error al obtener eventos:', err);
    return [];
  }
}