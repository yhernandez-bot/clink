import { getCuponaticPromos } from './cuponatic.mjs';

const promos = await getCuponaticPromos(2);
console.log("✅ Resultado de Cuponatic:", promos);
