const { number } = (() => {
  const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  return { number: n };
})();

function haversineKm(lat1, lon1, lat2, lon2) {
  const a = Number(lat1), b = Number(lon1), c = Number(lat2), d = Number(lon2);
  if (![a,b,c,d].every(Number.isFinite)) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (c-a)*rad, dLon = (d-b)*rad;
  const x = Math.sin(dLat/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dLon/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function isResidentialDvf(item) {
  const t = String(item?.type || "").toLowerCase();
  return /maison|appartement|studio|immeuble d'habitation|local d'habitation/.test(t);
}

function project(lat, lon) {
  const latN = Number(lat), lonN = Number(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;
  const kmPerLon = 111.32 * Math.max(0.2, Math.cos(latN * Math.PI / 180));
  return { x: lonN * kmPerLon, y: latN * 110.57 };
}

function cellFor(lat, lon, sizeKm = 0.5) {
  const p = project(lat, lon);
  if (!p) return null;
  return Math.floor(p.x / sizeKm) + ":" + Math.floor(p.y / sizeKm);
}

function median(values) {
  const a = values.filter(Number.isFinite).sort((x,y) => x-y);
  if (!a.length) return 0;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}

function percentile(values, p) {
  const a = values.filter(Number.isFinite).sort((x,y) => x-y);
  if (!a.length) return 0;
  const i = (a.length-1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi]-a[lo])*(i-lo);
}

function normalizeScore(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 50;
  return Math.max(0, Math.min(100, Math.round((value-min)/(max-min)*100)));
}

function classifyPotential(cell) {
  const activity = cell.activity_index;
  const seller = cell.seller_index;
  const density = cell.terrain_density;
  if (seller >= 65 && activity >= 60 && density >= 3) return "fort";
  if (seller >= 65 && density >= 3) return "reservoir";
  if (activity >= 60 && seller < 65) return "marche_actif";
  if (seller >= 45) return "a_surveiller";
  return "faible";
}

function potentialLabel(type) {
  return ({
    fort: "Prospection immédiate",
    reservoir: "Réservoir vendeur",
    marche_actif: "Marché actif",
    a_surveiller: "À surveiller",
    faible: "Faible priorité"
  })[type] || "À surveiller";
}

function confidenceLabel(value) {
  if (value >= 80) return "Élevée";
  if (value >= 60) return "Bonne";
  if (value >= 40) return "Intermédiaire";
  return "Faible";
}

function buildSectorRadar({ dpe = [], dvf = [], current = [], hidden = [], cellSizeKm = 0.5 } = {}) {
  const residentialDvf = (dvf || []).filter(isResidentialDvf);
  const cutoff = new Date().getUTCFullYear() - 2;
  const recentDvf = residentialDvf.filter(x => Number(x.year) >= cutoff);
  const cells = new Map();

  const ensure = (lat, lon) => {
    const key = cellFor(lat, lon, cellSizeKm);
    if (!key) return null;
    if (!cells.has(key)) cells.set(key, {
      key, latSum: 0, lonSum: 0, geoCount: 0,
      dvf24: [], current: [], candidates: [], dpe: []
    });
    const c = cells.get(key);
    c.latSum += Number(lat); c.lonSum += Number(lon); c.geoCount++;
    return c;
  };

  for (const x of recentDvf) {
    if (x.latitude == null || x.longitude == null) continue;
    const c = ensure(x.latitude, x.longitude);
    if (c) c.dvf24.push(x);
  }
  for (const x of dpe) {
    if (x.lat == null || x.lon == null) continue;
    const c = ensure(x.lat, x.lon);
    if (c) c.dpe.push(x);
  }
  for (const x of current) {
    if (x.lat == null || x.lon == null) continue;
    const c = ensure(x.lat, x.lon);
    if (c) c.current.push(x);
  }
  for (const x of hidden) {
    if (x.lat == null || x.lon == null) continue;
    const c = ensure(x.lat, x.lon);
    if (c) c.candidates.push(x);
  }

  const raw = [...cells.values()].map(c => {
    const lat = c.latSum / c.geoCount;
    const lon = c.lonSum / c.geoCount;
    const strong = c.candidates.filter(x => Boolean(x.terrain_ready) || Number(x.score) >= 72);
    const probable = c.candidates.filter(x => Number(x.score) >= 58);
    const medianM2 = median(c.dvf24
      .filter(x => Number(x.price) > 0 && Number(x.built_surface) > 0)
      .map(x => Number(x.price) / Number(x.built_surface)));
    const targetedValue = strong.reduce((sum, x) => {
      const s = Number(x.surface) || 0;
      return sum + (s > 0 && medianM2 > 0 ? s * medianM2 : 0);
    }, 0);
    const distances = [];
    for (let i=0; i<strong.length; i++) {
      let nearest = Infinity;
      for (let j=0; j<strong.length; j++) {
        if (i === j) continue;
        const d = haversineKm(strong[i].lat, strong[i].lon, strong[j].lat, strong[j].lon);
        if (d < nearest) nearest = d;
      }
      if (Number.isFinite(nearest)) distances.push(nearest);
    }
    const avgNearestKm = median(distances);
    const areaKm2 = cellSizeKm * cellSizeKm;
    const terrainDensity = strong.length / areaKm2;
    const avgSurface = median(strong.map(x => Number(x.surface) || 0).filter(x => x > 0));
    const dpeSignals = c.dpe.filter(x => ["E","F","G"].includes(String(x.dpe || "").toUpperCase())).length;
    const dpeSample = c.dpe.length;
    const dpeForte = c.dpe.filter(x => ["F","G"].includes(String(x.dpe || "").toUpperCase())).length;
    const dpeSampleConfidence = Math.min(100, Math.round((dpeSample / 25) * 100));
    const observableCompetition = c.current.length;
    const activityRaw = c.dvf24.length;
    const sellerRaw = probable.length;
    const terrainRaw = strong.length;
    const dataConfidence = Math.round(
      Math.min(100, 55 + Math.min(30, c.dvf24.length * 5) + Math.min(15, dpeSampleConfidence * 0.15))
    );

    return {
      key: c.key, lat, lon,
      transactions_24m: activityRaw,
      dpe_sample: dpeSample,
      dpe_energetic: dpeSignals,
      dpe_fg: dpeForte,
      candidates_probable: sellerRaw,
      candidates_strong: terrainRaw,
      current_listings: observableCompetition,
      median_price_m2: Math.round(medianM2 || 0),
      targeted_value: Math.round(targetedValue),
      avg_target_surface: Math.round(avgSurface || 0),
      terrain_density: Number(terrainDensity.toFixed(1)),
      nearest_prospect_km: Number.isFinite(avgNearestKm) ? Number(avgNearestKm.toFixed(2)) : null,
      dpe_sample_confidence: dpeSampleConfidence,
      data_confidence: dataConfidence
    };
  });

  if (!raw.length) {
    return {
      version: "1.0",
      cell_size_km: cellSizeKm,
      cells: [],
      zones: [],
      summary: { cells: 0, zones: 0, note: "Aucune donnée géolocalisée exploitable." }
    };
  }

  const activityValues = raw.map(x => x.transactions_24m);
  const sellerValues = raw.map(x => x.candidates_probable);
  const densityValues = raw.map(x => x.terrain_density);
  raw.forEach(c => {
    c.activity_index = normalizeScore(c.transactions_24m, percentile(activityValues, .1), percentile(activityValues, .9));
    c.seller_index = normalizeScore(c.candidates_probable, percentile(sellerValues, .1), percentile(sellerValues, .9));
    c.density_index = normalizeScore(c.terrain_density, percentile(densityValues, .1), percentile(densityValues, .9));
    c.potential_stat = Math.round((c.activity_index * .45) + (c.seller_index * .55));
    c.potential_terrain = Math.round((c.seller_index * .45) + (c.density_index * .35) + (c.data_confidence * .20));
    c.competition_observable = c.current_listings;
    c.competition_note = "Annonces visibles uniquement — ne mesure pas la force réelle des agences.";
    c.rotation = null;
    c.rotation_note = "Non calculée : parc de logements infra-cellulaire non disponible dans les données actuelles.";
    c.recommendation = classifyPotential(c);
    c.recommendation_label = potentialLabel(c.recommendation);
    c.confidence = c.data_confidence;
    c.confidence_label = confidenceLabel(c.confidence);
    c.reasons = [];
    if (c.transactions_24m >= 3) c.reasons.push("activité DVF résidentielle");
    if (c.candidates_strong >= 3) c.reasons.push(c.candidates_strong + " signaux vendeurs forts");
    if (c.terrain_density >= 3) c.reasons.push("forte densité terrain");
    if (c.current_listings === 0) c.reasons.push("aucune annonce observable");
    if (c.dpe_fg >= 3) c.reasons.push(c.dpe_fg + " DPE F/G");
    if (c.confidence < 60) c.reasons.push("confiance limitée des données");
  });

  // Fusion géographique : cellules voisines dans une zone commerciale si elles
  // présentent un potentiel vendeur significatif. Aucun score global n'est créé.
  const byKey = new Map(raw.map(x => [x.key, x]));
  const visited = new Set();
  const zones = [];
  const neighbors = (key) => {
    const [x,y] = key.split(":").map(Number);
    const out = [];
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
      if (!dx && !dy) continue;
      const k = (x+dx)+":"+(y+dy);
      if (byKey.has(k)) out.push(k);
    }
    return out;
  };

  for (const cell of raw) {
    if (visited.has(cell.key)) continue;
    if (cell.potential_terrain < 45 && cell.potential_stat < 45) continue;
    const queue = [cell.key], members = [];
    visited.add(cell.key);
    while (queue.length) {
      const k = queue.shift();
      const c = byKey.get(k); members.push(c);
      for (const n of neighbors(k)) {
        if (visited.has(n)) continue;
        const nc = byKey.get(n);
        if (nc && (nc.potential_terrain >= 45 || nc.potential_stat >= 45)) {
          visited.add(n); queue.push(n);
        }
      }
    }
    const strong = members.reduce((s,c)=>s+c.candidates_strong,0);
    const probable = members.reduce((s,c)=>s+c.candidates_probable,0);
    const transactions = members.reduce((s,c)=>s+c.transactions_24m,0);
    const listings = members.reduce((s,c)=>s+c.current_listings,0);
    const targetedValue = members.reduce((s,c)=>s+c.targeted_value,0);
    const lat = members.reduce((s,c)=>s+c.lat,0)/members.length;
    const lon = members.reduce((s,c)=>s+c.lon,0)/members.length;
    const density = members.reduce((s,c)=>s+c.terrain_density,0)/members.length;
    const confidence = Math.round(members.reduce((s,c)=>s+c.confidence,0)/members.length);
    zones.push({
      id: "Z" + String(zones.length+1).padStart(2,"0"),
      cells: members.map(c=>c.key),
      cell_count: members.length,
      center: {lat, lon},
      transactions_24m: transactions,
      candidates_probable: probable,
      candidates_strong: strong,
      current_listings: listings,
      targeted_value: Math.round(targetedValue),
      terrain_density: Number(density.toFixed(1)),
      confidence,
      confidence_label: confidenceLabel(confidence),
      potential_stat: Math.round(members.reduce((s,c)=>s+c.potential_stat,0)/members.length),
      potential_terrain: Math.round(members.reduce((s,c)=>s+c.potential_terrain,0)/members.length),
      recommendation: strong >= 6 && transactions >= 3 ? "prospection_immediate" : strong >= 3 ? "a_tester" : "surveillance",
      recommendation_label: strong >= 6 && transactions >= 3 ? "Zone à tester immédiatement" : strong >= 3 ? "Zone à tester" : "Zone à surveiller"
    });
  }

  zones.sort((a,b) => b.potential_terrain-a.potential_terrain || b.potential_stat-a.potential_stat);

  return {
    version: "1.0",
    cell_size_km: cellSizeKm,
    methodology: {
      activity_window_months: 24,
      cell_size_m: Math.round(cellSizeKm*1000),
      strong_signal_definition: "terrain_ready ou score vendeur >= 72",
      competition_definition: "annonces publiques observables uniquement",
      rotation_status: "en attente du parc de logements infra-cellulaire",
      terrain_time: "approximation : 10 min par prospect + déplacement géographique × 1,3, avec marge ±20%"
    },
    cells: raw.sort((a,b)=>b.potential_terrain-a.potential_terrain || b.potential_stat-a.potential_stat),
    zones,
    summary: {
      cells: raw.length,
      zones: zones.length,
      transactions_24m: recentDvf.length,
      candidates_probable: hidden.filter(x=>Number(x.score)>=58).length,
      candidates_strong: hidden.filter(x=>Boolean(x.terrain_ready) || Number(x.score)>=72).length,
      note: "Les indicateurs servent à tester les zones de prospection. Ils ne constituent pas une prédiction de vente."
    }
  };
}

module.exports = { buildSectorRadar };
