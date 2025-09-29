// sources/mercadolibre.mjs
// Extrae productos LEGO con descuento desde MercadoLibre.

const URL = "https://listado.mercadolibre.com.mx/juegos-juguetes/juegos-construccion/bloques-figuras-armar/lego/lego_Discount_25-100_NoIndex_True";

export async function getLegoPromos(limit = 5) {
  try {
    const res = await fetch(URL);
    const html = await res.text();

    const items = [...html.matchAll(/<a .*?href="(https:\/\/articulo\.mercadolibre\.com\.mx\/.*?)".*?<h2 class="ui-search-item__title">(.*?)<\/h2>.*?price-tag-fraction.*?>([\d,]+)/gs)];

    const promos = items.slice(0, limit).map(([, url, title, price]) => ({
      title: title.trim(),
      url,
      price: `$${price} MXN`
    }));

    return promos;
  } catch (err) {
    console.error("❌ Error MercadoLibre:", err);
    return [];
  }
}