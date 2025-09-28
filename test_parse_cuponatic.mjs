import fs from 'fs/promises';

const html = await fs.readFile('cuponatic_raw.html', 'utf8');

// Normaliza espacios
const cleaned = html.replace(/\s+/g, ' ');

// Busca cualquier <a> con /ofertas/
const re = /<a[^>]+href="(\/ofertas\/[^"]+)"[^>]*>(.*?)<\/a>/gi;

let m;
const rows = [];
while ((m = re.exec(cleaned)) !== null) {
  let url = m[1];
  let raw = m[2] || '';

  // Limpia etiquetas
  const title = raw.replace(/<[^>]*>/g, '').trim();

  // Filtra títulos muy cortos o de navegación
  if (!title || title.length < 5) continue;
  if (/(ayuda|vende|ver\s+todos|iniciar sesión|regístrate)/i.test(title)) continue;

  if (!url.startsWith('http')) url = 'https://www.cuponatic.com.mx' + url;

  rows.push({ title, url });
}

// Quita duplicados y muestra 10
const uniq = new Map();
for (const r of rows) {
  if (!uniq.has(r.url)) uniq.set(r.url, r);
}
const promos = Array.from(uniq.values()).slice(0, 10);

console.log('✅ Encontradas:', promos.length);
console.log(promos);

