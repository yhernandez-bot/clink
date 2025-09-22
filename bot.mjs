import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { getTopCdmxEvent } from './eventbrite.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env'), override: true });
console.log('DEBUG BOT_TOKEN?', !!process.env.BOT_TOKEN);

const bot = new Telegraf(process.env.BOT_TOKEN);


// Mensaje de bienvenida y ayuda para obtener tu CHAT_ID
bot.start(async (ctx) => {
  const welcome =
    'Clink! 👋 Soy tu bot de ofertas y planes en CDMX.\n' +
    'Todos los días te compartiré lo mejor sin ruido: 🚨 promos, 🎶 eventos y 🍔 recomendaciones.';
  await ctx.reply(welcome);
  console.log('Tu CHAT_ID es:', ctx.chat?.id, '→ Cópialo y pégalo en .env como CHAT_ID=');
});

// Contenido de ejemplo (luego lo conectamos a las APIs reales)
async function buildDigest() {
  const evento = await getTopCdmxEvent(); // intenta traer un evento real de CDMX
  return [
    '🚨 Promo\nCafetera con 25% OFF (envío rápido a CDMX)\n👉 Ver oferta: https://ejemplo.com',
    evento || '🎶 Evento\n(Cargando eventos reales de Eventbrite…)\n🎟️ Pronto conectamos más fuentes 🔌',
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
    await bot.telegram.sendMessage(chatId, block, { disable_web_page_preview: false });
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
