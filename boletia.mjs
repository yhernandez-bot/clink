// boletia.mjs
import fetch from 'node-fetch';

export async function getTopBoletiaEvents() {
  const url = `https://boletiaapi.com/api/v1/events?per_page=5&sort=start_date`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.data) {
      console.log("[Boletia] Sin eventos encontrados");
      return [];
    }

    return data.data.map(ev => ({
      name: ev.attributes.name,
      url: ev.attributes.public_url,
      start: ev.attributes.start_date,
      venue: ev.attributes.venue?.name || "Lugar por confirmar"
    }));
  } catch (err) {
    console.error("[Boletia] Error al obtener eventos:", err);
    return [];
  }
}