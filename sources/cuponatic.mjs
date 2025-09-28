export async function getCuponaticPromos(limit = 5) {
  try {
    const url = "https://mx-api.cuponatic-latam.com/api2/cdn/descuentos/menu/bombazos-sept25?ciudad=Mexico+DF&v=26&page=1";
    const res = await fetch(url);
    const json = await res.json();

    // La API a veces devuelve {descuentos: [...]}, o {items: [...]}, o {data: [...]}
    const arr = Array.isArray(json) ? json : (json.descuentos || json.items || json.data || []);

    return arr.slice(0, limit).map(p => ({
      title: p.titulo || "",
      price: p.valor_oferta ?? "",
      url: p.url_desktop || p.url_mobile || ""
    }));
  } catch (err) {
    console.error("❌ Error Cuponatic:", err);
    return [];
  }
}
