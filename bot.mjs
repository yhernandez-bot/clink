import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { getTopCdmxEvents } from './eventbrite.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


// Mensaje de bienvenida y ayuda para obtener tu CHAT_ID
bot.start(async (ctx) => {
  const welcome =
    'Clink! 👋 Soy tu bot de ofertas y planes en CDMX.\n' +
    'Todos los días te compartiré lo mejor sin ruido: 🚨 promos, 🎶 eventos y 🍔 recomendaciones.';
  await ctx.reply(welcome);
  console.log('Tu CHAT_ID es:', ctx.chat?.id, '→ Cópialo y pégalo en .env como CHAT_ID=');
});

async function buildDigest() {
  const events = await getTopCdmxEvents();
  const eventosBlocks = events.length
    ? events.map(ev =>
        `🎟️ *${ev.name}*\n🗓️ ${ev.start}\n📍 ${ev.venue}\n➡️ ${ev.url}`
      )
    : ['🎶 (Por ahora no hay eventos nuevos en CDMX para mostrar)'];

  return [
    '🚨 Promo\nCafetera con 25% OFF (envío rápido a CDMX)\n👉 Ver oferta: https://ejemplo.com',
    ...eventosBlocks,
    '🍔 Recomendación\nTaquería nueva en Roma con 3x2 en pastor (viernes)\n📍 Álvaro Obregón 200\n🗺️ Maps: https://ejemplo.com'
  ];
}

// Envía el digest al chat configurado en .env
async function sendDigestOnce() {
  const chatId = process.env.CHAT_ID;
  if (!chatId) {
    console.error('Falta CHAT_ID en .env. Manda /start al bot y revisa la consola para obtenerlo.');
    return;
  }
  const blocks = await buildDigest();
  for (const block of blocks) {
    await bot.telegram.sendMessage(chatId, block, {
  parse_mode: 'Markdown',
  disable_web_page_preview: false,
  reply_markup: buildInlineKeyboard(block),
});

  }
  console.log('Digest enviado a', chatId);
}

// Programa envío diario 11:00 CDMX
function scheduleDailyDigest() {
  cron.schedule('0 11 * * *', async () => {
    try {
      await sendDigestOnce();
    } catch (e) {
      console.error('Error enviando digest programado:', e);
    }
  }, { timezone: 'America/Mexico_City' });

  console.log('Programado: envío diario 11:00 America/Mexico_City');
}

// Modo CLI vs servidor
const mode = process.argv[2];
if (mode === 'send') {
  console.log('Enviando sin launch()…');
  await sendDigestOnce(); // usa bot.telegram directamente
  process.exit(0);
} else {
  await bot.launch();     // solo en modo servidor
  scheduleDailyDigest();
  console.log('Bot listo. Escribe /start a tu bot en Telegram.');
}

// Apagado limpio
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
