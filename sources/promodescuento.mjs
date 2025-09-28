// sources/promodescuento.mjs
// Fuente: Promodescuentos (RSS). Filtra publicaciones que mencionan CDMX.
// Sin dependencias externas. Node 18+ (fetch nativo).

const RSS_URL = 'https://www.promodescuentos.com/rss';

/**
 * Descarga el RSS y regresa ofertas relevantes para CDMX.
 * @param {number} limit - máximo de resultados a regresar
 * @returns {Promise<Array<{title:string,url:string,source:string,text:string}>>}
 */
export async function getPromodescuentosDeals(limit = 5) {
  try {
    const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'ClinkBot/1.0' } });
    if (!res.ok) {
      console.warn('[PD] RSS status:', res.status);
      return [];
    }
    const xml = await res.text();

    // Partimos por <item>…</item> (muy simple y suficiente para RSS estándar)
    const items = xml.split('<item>').slice(1).map(chunk => '<item>' + chunk);

    const keywords = [
      'cdmx','ciudad de méxico','mexico city',
      'polanco','roma','condesa','coyoacán','narvarte','del valle','santa fe',
      'miguel hidalgo','cuauhtémoc','benito juárez','iztapalapa','tacubaya',
      'reforma','insurgentes','perisur','parque delta','antara'
    ];

    const cleaned = (s) => s
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    const parseTag = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? cleaned(m[1]) : '';
    };

    const deals = [];

    for (const it of items) {
      const title = parseTag(it, 'title');
      const link  = parseTag(it, 'link');
      const desc  = parseTag(it, 'description');
      const textForMatch = (title + ' ' + desc).toLowerCase();

      const hasCdmx = keywords.some(k => textForMatch.includes(k));
      if (!hasCdmx) continue;

      // Armamos texto listo para Telegram (sin botones; eso lo añade el bot)
      const text = `💥 *Oferta local (PD)*\n*${title}*\n➡️ ${link}`;

      deals.push({
        title,
        url: link,
        source: 'Promodescuentos',
        text
      });

      if (deals.length >= limit) break;
    }

    return deals;
  } catch (err) {
    console.error('❌ Promodescuentos error:', err?.message || err);
    return [];
  }
}

export default { getPromodescuentosDeals };
