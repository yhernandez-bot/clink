import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


import dotenv from 'dotenv';
dotenv.config(); // sin override
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { getTopCdmxEvent } from './sources/eventbrite.mjs';
import { getTopTicketmasterEvents } from './sources/ticketmaster.mjs';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { getCuponaticPromos } from './sources/cuponatic.mjs';
import { getPromodescuentosDeals } from './sources/promodescuento.mjs';
import { getLegoPromos } from './sources/mercadolibre.mjs';


// Formatea "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm" de forma segura
function prettyDate(start) {
  if (!start) return '';
  try {
    // Convierte string a fecha
    const dt = parseISO(start);  
    return format(dt, "EEE d MMM — HH:mm", { locale: es });
  } catch (err) {
    console.error('❌ Error al formatear fecha:', start, err);
    return start; // devuelve el string tal cual si falla
  }
}


dotenv.config({ path: path.join(__dirname, '.env'), override: true });
console.log('DEBUG BOT_TOKEN?', !!process.env.BOT_TOKEN);

const bot = new Telegraf(process.env.BOT_TOKEN);

/** Crea un inline keyboard a partir de los links que encuentre en el texto */
function buildInlineKeyboard(text) {
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const links = [...text.matchAll(urlRegex)].map(m => m[1]);
  if (!links.length) return undefined;

  const rows = [];
  for (const url of links) {
    let label = '🔗 Abrir';
    if (url.includes('eventbrite')) label = '🎫 Ver en Eventbrite';
    else if (url.includes('maps.google')) label = '📍 Abrir mapa';
    else if (/oferta|promo|ver oferta/i.test(text)) label = '🛒 Ver oferta';

    rows.push([{ text: label, url }]); // un botón por fila
  }
  return { inline_keyboard: rows };
}

// === Cuponatic: envío de promos (manual/cron) ===
async function sendCuponaticOnce(limit = 3) {
  try {
    const promos = await getCuponaticPromos(limit);

    if (!promos || promos.length === 0) {
      await bot.telegram.sendMessage(
        process.env.CHAT_ID,
        "Hoy no encontré promos de Cuponatic 😕"
      );
      return;
    }

    // arma el mensaje (Markdown)
    const text =
      "🛍️ *Promos de Cuponatic hoy:*\n\n" +
      promos
        .map(
          (p) =>
            `🎯 *${p.title}*\n` +
            `💵 ${p.price || "$"}\n` +
            `🔗 [Ver oferta](${p.url})`
        )
        .join("\n\n");

    await bot.telegram.sendMessage(process.env.CHAT_ID, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error("Error enviando promos Cuponatic:", err);
  }
}

// permite ejecutarla por CLI → `node bot.mjs cuponatic:send`
if (process.argv[2] === "cuponatic:send") {
  sendCuponaticOnce();
}


// Mensaje de bienvenida y ayuda para obtener tu CHAT_ID
bot.start(async (ctx) => {
  const welcome =
    'Clink! 👋 Soy tu bot de ofertas y planes en CDMX.\n' +
    'Todos los días te compartiré lo mejor sin ruido: 🚨 promos, 🎶 eventos y 🍔 recomendaciones.';
  await ctx.reply(welcome);
  console.log('Tu CHAT_ID es:', ctx.chat?.id, '→ Cópialo y pégalo en .env como CHAT_ID=');
});

async function buildDigest() {
  // 1) Trae todo en paralelo y cae en arrays vacíos si algo falla
  const [ebEvents, tmEvents, cuponaticPromos, pdDeals, legoPromos] = await Promise.all([
  getTopCdmxEvent().catch(() => []),
  getTopTicketmasterEvents().catch(() => []),
  getCuponaticPromos().catch(() => []),
  getPromodescuentosDeals().catch(() => []),
  getLegoPromos().catch(() => []),
]);

  // 2) Promos Cuponatic (máx 2 – silencioso si no hay)
const promoBlocks = (cuponaticPromos || [])
  .slice(0, 2)
  .map(p => {
    const title = p?.title?.trim() || 'Promo sin título';
    const price = p?.price ? `💸 ${p.price}` : '';
    let url = (p?.url || '').trim();

    // Normalizar URL:
    // - si viene como //algo -> anteponer https:
    // - si viene relativa (/ruta o ruta) -> anteponer dominio
    if (url && !/^https?:\/\//i.test(url)) {
      if (url.startsWith('//')) {
        url = `https:${url}`;
      } else {
        url = `https://www.cuponatic.com.mx${url.startsWith('/') ? '' : '/'}${url}`;
      }
    }

    // Validar URL final (solo dominios de cuponatic México)
    if (!/^https?:\/\/(www|ayuda)\.cuponatic\.com\.mx(\/|$)/i.test(url)) return null;

    // (Opcional) Debug para ver qué quedó
    // console.log('Cuponatic URL normalizada ->', url);

    return `🛍 *${title}*\n${price}\n🔗 [Ver oferta](${url})`;
  })
  .filter(Boolean);

// 3) Eventbrite — silencioso si no hay
const ebBlocks = (ebEvents || [])
  .map(ev => {
    const fecha = ev?.start ? prettyDate(ev.start) : '📅 Fecha no disponible';
    const nombre = ev?.name || 'Evento sin nombre';
    const venue = ev?.venue || '📍 Lugar no disponible';
    const url = (ev?.url || '').trim();
    if (!nombre || !url) return null;
    return `🎫 *${nombre}*\n${fecha}\n${venue}\n🔗 [Ver en Eventbrite](${url})`;
  })
  .filter(Boolean);

// 4) Ticketmaster — dedupe por nombre y top 5, silencioso si no hay
const vistos = new Set();
const unicos = [];
for (const ev of tmEvents || []) {
  const key = (ev?.name || '').trim();
  if (!key || vistos.has(key)) continue;
  vistos.add(key);
  unicos.push(ev);
  if (unicos.length >= 5) break;
}

const tmBlocks = unicos
  .map(ev => {
    const fechasArr = Array.isArray(ev?.dates)
      ? ev.dates.map(f => prettyDate(f)).filter(Boolean)
      : [prettyDate(ev?.start)].filter(Boolean);
    const fechas = fechasArr.join(', ') || '📅 Fecha no disponible';
    const nombre = ev?.name || 'Evento sin nombre';
    const venue = ev?.venue || '📍 Lugar no disponible';
    const url = (ev?.url || '').trim();
    if (!nombre || !url) return null;
    return `🎶 *${nombre}*\nFunciones: ${fechas}\n${venue}\n🔗 [Ver en Ticketmaster](${url})`;
  })
  .filter(Boolean);

// 5) LEGO (MercadoLibre) – máximo 5
const legoBlocks = (legoPromos || [])
  .slice(0, 5)
  .map(p => `🧱 *${p.title}*\n💸 ${p.price}\n➡️ ${p.url}`)
  .filter(Boolean);

// 2bis) Promodescuentos (silencioso si no hay)
const pdBlocks = (pdDeals || [])
  .map(d => {
    const title = d.title?.trim() || 'Oferta sin título';
    const priceLine = d.price ? `💲 ${d.price}\n` : '';
    const url = d.url?.trim();
    if (!url) return null;

    return (
      `💥 *Oferta en Promodescuentos*\n` +
      `*${title}*\n` +
      `${priceLine}` +
      `🔗 [Ver oferta](${url})`
    );
  })
  .filter(Boolean);


// ---- DEBUG: contadores por bloque (solo consola) ----
console.log('DEBUG Counters:', {
  promos: promoBlocks?.length ?? 0,
  promodescuentos: pdBlocks?.length ?? 0,
  eventbrite: ebBlocks?.length ?? 0,
  ticketmaster: tmBlocks?.length ?? 0,
});
  // 6) Devuelve sólo lo que haya; si no hay nada, el caller no enviará mensajes
  return [
  ...promoBlocks,        // Cuponatic
  ...pdBlocks,           // Promodescuentos
  ...ebBlocks,           // Eventbrite
  ...tmBlocks,           // Ticketmaster
  ...legoBlocks,         // LEGO – NUEVO
];


// Enviar a Telegram con manejo de errores y logs útiles
async function safeSend(bot, chatId, text, extra) {
  try {
    await bot.telegram.sendMessage(chatId, text, extra);
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);
    console.error('❌ Error enviando mensaje a Telegram:', desc);
    try {
      // En muchos 400 el problema es la URL del botón
      console.error('Payload (primeras 200 chars):', (text || '').slice(0, 200));
      if (extra?.reply_markup) {
        console.error('Inline keyboard:', JSON.stringify(extra.reply_markup));
      }
    } catch {}
  }
}

// Envía el digest al chat configurado en .env (con logs y guardas)
async function sendDigestOnce() {
  const chatId = process.env.CHAT_ID;
  if (!chatId) {
    console.error('Falta CHAT_ID en .env. Manda /start al bot y revisa la consola para obtenerlo.');
    return;
  }

  console.log('▶️  Construyendo digest…');
  const blocks = await buildDigest();

  // Conteo final por tipo (depende de cómo armaste buildDigest)
  const totals = {
  promos: (blocks || []).filter(b => b.includes('🎁')).length,
  promodescuentos: (blocks || []).filter(b => b.includes('💸')).length,
  eventbrite: (blocks || []).filter(b => b.includes('🎟') || b.includes('🎤') || b.includes('Evento')).length,
  ticketmaster: (blocks || []).filter(b => b.includes('🎫') || b.includes('Ticketmaster')).length,
};
  console.log('📊 Totales a enviar:', totals, 'Total=', blocks.length);

  if (!blocks || blocks.length === 0) {
    console.log('ℹ️  Nada que enviar (0 bloques). No se manda mensaje.');
    return;
  }

  // Enviar cada bloque con teclado inline cuando aplique
  for (const block of blocks) {
    await safeSend(bot, chatId, block, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
      reply_markup: buildInlineKeyboard(block),
    });
  }

  console.log('✅ Digest enviado a', chatId);
}


// Programa el envío diario 11:00 CDMX con logs y manejo de errores
function scheduleDailyDigest() {
  cron.schedule('0 11 * * *', async () => {
    console.log('⏰ Cron 11:00 disparado (America/Mexico_City). DIGEST_ENABLED=', process.env.DIGEST_ENABLED);
    try {
      if (process.env.DIGEST_ENABLED === 'true') {
        await sendDigestOnce();
      } else {
        console.log('⏸️  Digest automático desactivado por DIGEST_ENABLED');
      }
    } catch (e) {
      console.error('⚠️  Error en ejecución del cron:', e?.message || e);
    }
  });

  // (Opcional) un heartbeat útil para confirmar que el proceso está vivo
  console.log('🗓️  Cron programado: diario 11:00 America/Mexico_City');
}

// Enviar promos de Cuponatic una vez al día (ejemplo: 9:00 am)
cron.schedule('0 9 * * *', async () => {
  try {
    const promos = await getCuponaticPromos();
    console.log('🧨 Enviando Cuponatic diario…', promos);

    if (promos.length > 0) {
      const text = promos
        .map(p => `🎁 *${p.title}*\n💲${p.price}\n🔗 ${p.url}`)
        .join('\n\n');

      await bot.telegram.sendMessage(process.env.CHAT_ID, text, {
        parse_mode: 'Markdown'
      });
    } else {
      console.log('ℹ️ Cuponatic: no hay promos hoy, no se envía mensaje.');
    }
  } catch (err) {
    console.error('❌ Error en cron Cuponatic:', err);
  }
}, {
  timezone: 'America/Mexico_City'
});


// ==== Modo CLI vs servidor ====
const mode = process.argv[2];

if (mode === 'send') {
  console.log('Enviando sin launch()…');
  await sendDigestOnce(); // usa bot.telegram directamente
  process.exit(0);

} else if (mode === 'cuponatic:send') {
  console.log('Enviando Cuponatic sin launch()…');
  try {
    const promos = await getCuponaticPromos();
    if (promos.length > 0) {
      const text = promos
        .map(p => `🛍️ *${p.title}*\n💲${p.price}\n🔗 ${p.url}`)
        .join('\n\n');
      await bot.telegram.sendMessage(process.env.CHAT_ID, text, {
        parse_mode: 'Markdown',
      });
    } else {
      console.log('ℹ️ Cuponatic: no hay promos para enviar.');
    }
  } catch (err) {
    console.error('❌ Error cuponatic:send', err);
  }
  process.exit(0);

} else if (mode === 'eventbrite:send') {
  console.log('Enviando Eventbrite sin launch()…');
  try {
    const ev = await getTopCdmxEvent();
    if (!ev) {
      console.log('ℹ️ Eventbrite: no hay eventos próximos en CDMX.');
    } else {
      await bot.telegram.sendMessage(process.env.CHAT_ID, ev.text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });
      console.log('✅ Eventbrite enviado:', ev.title);
    }
  } catch (err) {
    console.error('❌ Error eventbrite:send', err);
  }
  process.exit(0);

} else {
  // Modo servidor: lanza el bot y programa los cron jobs
  console.log('🟢 Iniciando bot en modo servidor…');
  await bot.launch();
  scheduleDailyDigest();
  console.log('✅ Bot iniciado y cron programado.');
}

// ==== Apagado limpio ====
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

