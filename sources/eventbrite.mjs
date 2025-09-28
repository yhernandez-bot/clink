// eventbrite.mjs
// Lee eventos desde Eventbrite usando la organización del usuario
// y regresa el próximo evento en CDMX (o null si no hay).
//
// Requiere la variable de entorno EB_TOKEN (ya la tienes en Railway).
// Funciona con Node 18+ (usa fetch nativo).

const EB_TOKEN = process.env.EB_TOKEN;
const API = "https://www.eventbriteapi.com/v3";

if (!EB_TOKEN) {
  console.warn("[Eventbrite] Falta EB_TOKEN");
}

// Helpers
const api = async (path, params = {}) => {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${EB_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[Eventbrite] ${res.status} ${text || res.statusText}`);
  }
  return res.json();
};

const toISO = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// Obtiene el primer id de organización del usuario
async function getOrgId() {
  const meOrgs = await api("/users/me/organizations/");
  const org = meOrgs.organizations?.[0];
  if (!org) throw new Error("[Eventbrite] No hay organizaciones en la cuenta");
  return org.id;
}

// Formatea fecha local breve
function formatDateShort(iso, tz = "America/Mexico_City") {
  try {
    const dt = new Date(iso);
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(dt)
      .replace(/\./g, "");
  } catch {
    return iso;
  }
}

// Determina si el venue está en CDMX (heurística)
function isCdmxVenue(venue) {
  const city =
    venue?.address?.city ||
    venue?.address?.region ||
    venue?.address?.localized_address_display ||
    "";
  const txt = String(city).toLowerCase();
  return (
    txt.includes("cdmx") ||
    txt.includes("ciudad de méxico") ||
    txt.includes("mexico city") ||
    txt.includes("miguel hidalgo") ||
    txt.includes("cuauhtémoc") ||
    txt.includes("coyoacán") ||
    txt.includes("roma") ||
    txt.includes("condesa") ||
    txt.includes("polanco") ||
    txt.includes("narvarte")
  );
}

/**
 * Obtiene el próximo evento de tu organización en CDMX dentro de los
 * próximos 14 días. Devuelve un objeto con datos básicos y un campo `text`
 * listo para Telegram. Si no hay eventos, devuelve null.
 */
export async function getTopCdmxEvent() {
  if (!EB_TOKEN) return null;

  try {
    const orgId = await getOrgId();

    // rango de fechas (hoy -> +45 días) en formato YYYY-MM-DD
const start = new Date().toISOString().split('T')[0];
const end   = new Date(Date.now() + 45*24*60*60*1000).toISOString().split('T')[0];

// ...y en la query/params:

    // Trae eventos de la organización; expand=venue para poder filtrar por ciudad
const list = await api(`/organizations/${orgId}/events`, {
  order_by: "start_asc",
  status: "live",
  "start_date.range_start": start,
  "start_date.range_end": end,
  expand: "venue",
  page_size: 50,
});

    const now = new Date();

    const events = (list.events || [])
      // Solo futuros (por si acaso)
      .filter((e) => new Date(e.start?.utc || e.start?.local || 0) > now)
      // Con venue y en CDMX
      .filter((e) => isCdmxVenue(e.venue || {}));

    console.log(
      `[Eventbrite] org=${orgId} eventos_en_rango=${(list.events || []).length} cdmx=${events.length}`
    );

    if (!events.length) return null;

    const ev = events[0];
    const title = ev.name?.text || "Evento";
    const url = ev.url;
    const startsIso = ev.start?.local || ev.start?.utc;
    const when = formatDateShort(startsIso);
    const venueName =
      ev.venue?.name ||
      ev.venue?.address?.localized_address_display ||
      "Lugar por confirmar";

    const text =
      `🎟️ *Evento*\n` +
      `*${title}*\n` +
      `🗓️ ${when}\n` +
      `📍 ${venueName}\n` +
      `➡️ ${url}`;

    return {
      title,
      url,
      when,
      venue: venueName,
      text,
      raw: ev,
    };
  } catch (err) {
    console.warn(String(err));
    return null;
  }
}

// Export default por si el import lo espera así
export default { getTopCdmxEvent };
