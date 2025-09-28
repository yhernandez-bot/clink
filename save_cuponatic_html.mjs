import fs from 'node:fs/promises';

const url = 'https://www.cuponatic.com.mx/ofertas';
const res = await fetch(url, {
  headers: {
    'user-agent': 'Mozilla/5.0'
  }
});
const html = await res.text();

await fs.writeFile('cuponatic_raw.html', html, 'utf8');
console.log('✅ Guardado cuponatic_raw.html con', html.length, 'caracteres');
