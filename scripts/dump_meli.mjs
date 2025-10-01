import fs from 'node:fs/promises';

const LIST_URL =
  "https://listado.mercadolibre.com.mx/juegos-juguetes/juegos-construccion/bloques-figuras-armar/lego/lego_Discount_25-100_NoIndex_True#applied_filter_id=discount&applied_filter_name=Descuentos&applied_filter_order=9&applied_value_id=25-100&applied_value_name=Desde%2025%25%20OFF&applied_value_order=4&applied_value_results=237&is_custom=false";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
};

try {
  const res = await fetch(LIST_URL, { headers });
  console.log("HTTP:", res.status, res.statusText);
  const html = await res.text();
  console.log("HTML length:", html.length);
  await fs.writeFile("ml_dump.html", html, "utf8");
  console.log("Guardado en ml_dump.html (abre este archivo en VS Code).");
} catch (e) {
  console.error("Falló fetch:", e?.message || e);
}
