// scripts/test_lego.mjs
import { getLegoPromos } from '../sources/mercadolibre.mjs';

try {
  const promos = await getLegoPromos(5);
  console.log('✅ Promos LEGO (>=25% OFF):');
  console.log(JSON.stringify(promos, null, 2));
} catch (e) {
  console.error('❌ Error al probar getLegoPromos:', e?.message || e);
}