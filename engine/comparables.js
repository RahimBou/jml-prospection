"use strict";

const ENGINE_VERSION = "dvf-comparables-v1.0.0";
const DEFAULTS = Object.freeze({
  maxAgeYears: 10,
  initialRadiusKm: 5,
  expandedRadiusKm: 25,
  minComparables: 5,
  maxComparables: 20
});

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function normalizeType(value) {
  const s = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (s.includes("maison") || s === "house") return "Maison";
  if (s.includes("appartement") || s === "apartment") return "Appartement";
  return "";
}
function haversineKm(a, b) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}
function weightedQuantile(rows, q) {
  const sorted = rows.slice().sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, r) => sum + r.weight, 0);
  if (!total) return null;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= total * q) return row.value;
  }
  return sorted[sorted.length - 1].value;
}
function median(values) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function monthIndex(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear() * 12 + d.getUTCMonth();
}
function marketTrendFactor(sales, targetDate) {
  // Conservative local time adjustment: monthly median €/m² trend, only with
  // at least 12 sales spanning 12 months. Clamp to +/- 15% over the period.
  const targetMonth = monthIndex(targetDate);
  if (targetMonth === null) return { factor: 1, method: "aucun ajustement temporel", confidence: "faible" };
  const valid = sales.map(s => ({ month: monthIndex(s.date), p: s.price / s.surface }))
    .filter(x => x.month !== null && x.p > 0);
  if (valid.length < 12) return { factor: 1, method: "historique local insuffisant", confidence: "faible" };
  const months = [...new Set(valid.map(x => x.month))].sort((a, b) => a - b);
  if (months.length < 12) return { factor: 1, method: "historique local inférieur à 12 mois", confidence: "faible" };
  const oldMonth = months[0], recentMonth = months[months.length - 1];
  const oldMedian = median(valid.filter(x => x.month === oldMonth).map(x => x.p));
  const recentMedian = median(valid.filter(x => x.month === recentMonth).map(x => x.p));
  if (!oldMedian || !recentMedian || recentMonth === oldMonth) return { factor: 1, method: "tendance locale non calculable", confidence: "faible" };
  const monthly = Math.pow(recentMedian / oldMedian, 1 / (recentMonth - oldMonth));
  const raw = Math.pow(monthly, targetMonth - recentMonth);
  const factor = Math.max(0.85, Math.min(1.15, Number.isFinite(raw) ? raw : 1));
  return { factor, method: "tendance médiane locale, plafonnée à ±15 %", confidence: valid.length >= 30 ? "moyenne" : "faible" };
}
function estimate(input, sales, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  if (!input || typeof input !== "object") throw new TypeError("Caractéristiques du bien requises");
  const type = normalizeType(input.type);
  const surface = finite(input.surface);
  const terrain = finite(input.terrain);
  const rooms = finite(input.rooms);
  const latitude = finite(input.latitude), longitude = finite(input.longitude);
  const commune = String(input.commune || "").trim().toLocaleLowerCase("fr");
  if (!type) throw new TypeError("type doit être Maison ou Appartement");
  if (surface === null || surface < 9 || surface > 1000) throw new TypeError("surface doit être comprise entre 9 et 1000 m²");
  if (terrain !== null && (terrain < 0 || terrain > 100000)) throw new TypeError("terrain invalide");
  if (rooms !== null && (rooms < 1 || rooms > 30)) throw new TypeError("nombre de pièces invalide");
  if ((latitude === null) !== (longitude === null)) throw new TypeError("latitude et longitude doivent être fournies ensemble");
  if (latitude !== null && (latitude < 49.0 || latitude > 50.3 || longitude < 3.8 || longitude > 5.8)) throw new TypeError("coordonnées hors zone attendue des Ardennes");
  if (latitude === null && !commune) throw new TypeError("coordonnées ou commune requises");
  const now = new Date(input.dateReference || options.referenceDate || new Date());
  if (Number.isNaN(now.getTime())) throw new TypeError("dateReference invalide");
  const normalized = (Array.isArray(sales) ? sales : []).map(s => {
    const sType = normalizeType(s.type);
    const sSurface = finite(s.surface);
    const price = finite(s.price);
    const date = new Date(s.date);
    const lat = finite(s.latitude), lon = finite(s.longitude);
    return { ...s, type: sType, surface: sSurface, price, date, latitude: lat, longitude: lon,
      terrain: finite(s.terrain), rooms: finite(s.rooms), communeNorm: String(s.commune || "").trim().toLocaleLowerCase("fr") };
  }).filter(s => s.type && s.surface >= 9 && s.price > 1000 && Number.isFinite(s.date.getTime()) && s.date <= now && s.latitude !== null && s.longitude !== null);
  const maxAge = Number(cfg.maxAgeYears) || 10;
  const candidates = normalized.filter(s => s.type === type && (now - s.date) / 86400000 <= maxAge * 365.25);
  const choose = radius => candidates.map(s => {
    const distance = latitude !== null ? haversineKm({ latitude, longitude }, s) : null;
    const sameCommune = commune && s.communeNorm === commune;
    if (latitude !== null && distance > radius) return null;
    if (latitude === null && !sameCommune) return null;
    const surfaceRatio = s.surface / surface;
    if (surfaceRatio < 0.55 || surfaceRatio > 1.8) return null;
    const ageYears = Math.max(0, (now - s.date) / (365.25 * 86400000));
    const distanceWeight = distance === null ? 1 : Math.exp(-distance / Math.max(1, radius / 2));
    const surfaceWeight = Math.exp(-Math.abs(Math.log(surfaceRatio)) * 2.5);
    const ageWeight = Math.exp(-ageYears / 4);
    const roomWeight = rooms !== null && s.rooms !== null ? (s.rooms === rooms ? 1 : Math.exp(-Math.abs(s.rooms - rooms) * 0.3)) : 0.85;
    let landWeight = 0.85;
    if (type === "Maison" && terrain !== null && s.terrain !== null) {
      const ratio = (s.terrain + 50) / (terrain + 50);
      if (ratio < 0.25 || ratio > 4) landWeight = 0.45;
      else landWeight = Math.exp(-Math.abs(Math.log(ratio)) * 0.35);
    }
    const weight = distanceWeight * surfaceWeight * ageWeight * roomWeight * landWeight;
    return { sale: s, distanceKm: distance, ageYears, weight, rawPriceM2: s.price / s.surface };
  }).filter(Boolean).sort((a, b) => b.weight - a.weight).slice(0, cfg.maxComparables);
  let selected = latitude !== null ? choose(cfg.initialRadiusKm) : choose(cfg.initialRadiusKm);
  let radiusUsed = latitude !== null ? cfg.initialRadiusKm : null;
  if (selected.length < cfg.minComparables && latitude !== null) {
    selected = choose(cfg.expandedRadiusKm);
    radiusUsed = cfg.expandedRadiusKm;
  }
  if (selected.length < cfg.minComparables && latitude === null) {
    selected = candidates.filter(s => s.communeNorm === commune && s.surface / surface >= 0.55 && s.surface / surface <= 1.8)
      .map(s => ({ sale: s, distanceKm: null, ageYears: (now - s.date) / (365.25 * 86400000), weight: Math.exp(-Math.abs(Math.log(s.surface / surface)) * 2.5) * Math.exp(-((now - s.date) / 86400000 / 365.25) / 4), rawPriceM2: s.price / s.surface }))
      .sort((a, b) => b.weight - a.weight).slice(0, cfg.maxComparables);
  }
  if (!selected.length) return { value: null, low: null, high: null, reliability: "faible", comparableCount: 0, comparables: [], hypotheses: ["Aucune vente comparable exploitable trouvée."], exclusions: ["Type, surface, date, prix et coordonnées contrôlés."], engineVersion: ENGINE_VERSION, disclaimer: "Estimation indicative, ne remplace pas une expertise" };
  const trend = marketTrendFactor(selected.map(x => ({ date: x.sale.date, price: x.sale.price, surface: x.sale.surface })), now);
  const weighted = selected.map(x => ({ ...x, adjustedM2: x.rawPriceM2 * trend.factor, value: x.rawPriceM2 * trend.factor * surface }));
  const sumW = weighted.reduce((n, x) => n + x.weight, 0);
  const value = Math.round(weighted.reduce((n, x) => n + x.value * x.weight, 0) / sumW);
  const low = Math.round(weightedQuantile(weighted.map(x => ({ value: x.value, weight: x.weight })), 0.25));
  const high = Math.round(weightedQuantile(weighted.map(x => ({ value: x.value, weight: x.weight })), 0.75));
  const m2 = weighted.map(x => x.adjustedM2);
  const spread = (Math.max(...m2) - Math.min(...m2)) / Math.max(1, median(m2));
  let reliability = selected.length >= 10 && spread <= 0.35 ? "élevé" : selected.length >= 5 && spread <= 0.6 ? "moyen" : "faible";
  if (selected.length < cfg.minComparables || spread > 0.8 || trend.confidence === "faible") reliability = "faible";
  // Widen intervals when the evidence is weak; never pretend a small sample is precise.
  let widen = reliability === "faible" ? 0.15 : reliability === "moyen" ? 0.05 : 0;
  const adjustedLow = Math.max(0, Math.round(Math.min(low, value * (1 - widen))));
  const adjustedHigh = Math.round(Math.max(high, value * (1 + widen)));
  const comparables = weighted.slice().sort((a, b) => b.weight - a.weight).slice(0, 5).map(x => ({
    date: x.sale.date.toISOString().slice(0, 10), commune: x.sale.commune || "", type: x.sale.type,
    surface: x.sale.surface, terrain: x.sale.terrain, rooms: x.sale.rooms, price: x.sale.price,
    pricePerM2: Math.round(x.rawPriceM2), adjustedPricePerM2: Math.round(x.adjustedM2),
    distanceKm: x.distanceKm === null ? null : Math.round(x.distanceKm * 100) / 100,
    weight: Math.round(x.weight * 1000) / 1000, mutationId: x.sale.mutationId || null
  }));
  return {
    value, low: adjustedLow, high: adjustedHigh, reliability, comparableCount: selected.length, comparables,
    hypotheses: ["Prix central calculé par moyenne pondérée des ventes comparables.", trend.method, radiusUsed === null ? "Comparables limités à la commune." : "Rayon de recherche utilisé : " + radiusUsed + " km.", "L'état intérieur, les travaux, la vue et les nuisances ne sont pas connus."],
    exclusions: ["Ventes multi-biens écartées lors de l'import.", "Prix/surfaces et coordonnées invalides écartés.", "Seules les ventes antérieures à la date de référence sont utilisées."],
    trendFactor: Math.round(trend.factor * 1000) / 1000,
    engineVersion: ENGINE_VERSION,
    disclaimer: "Estimation indicative, ne remplace pas une expertise"
  };
}
module.exports = { estimate, haversineKm, weightedQuantile, marketTrendFactor, normalizeType, ENGINE_VERSION };