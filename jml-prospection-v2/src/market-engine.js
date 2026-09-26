const { searchPublicListings } = require("./sources");
const { fetchOpenDataSignals } = require("./open-data");
const { snapshot } = require("./memory");

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = [item.external_url || "", String(item.title || "").toLowerCase(), number(item.price), number(item.surface)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function classify(item) {
  const title = String(item.title || "").toLowerCase();
  if (/terrain|parcelle/.test(title)) return "terrain";
  if (/appartement|studio/.test(title)) return "appartement";
  if (/immeuble/.test(title)) return "immeuble";
  if (/garage|parking/.test(title)) return "garage-parking";
  if (/commerce|local commercial|boutique/.test(title)) return "commerce";
  return "maison";
}
function normalizeAddress(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(08000)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreDpe(dpe) {
  // DPE reste un signal important, mais ne doit plus dominer le classement.
  return dpe === "G" ? 20 : dpe === "F" ? 16 : dpe === "E" ? 8 : 0;
}

function scoreGes(ges) {
  return ges === "G" ? 8 : ges === "F" ? 6 : ges === "E" ? 3 : 0;
}

function scoreSurface(surface) {
  const s = Number(surface) || 0;
  if (s >= 80 && s <= 180) return 10;
  if (s >= 50 && s < 80) return 7;
  if (s > 180 && s <= 250) return 7;
  if (s > 250) return 4;
  if (s >= 30) return 3;
  return 0;
}

function scoreAge(year) {
  const y = Number(year) || 0;
  if (!y) return 0;
  if (y < 1945) return 15;
  if (y < 1970) return 12;
  if (y < 1990) return 8;
  if (y < 2005) return 5;
  return 2;
}

function scoreMarketAbsence() {
  return 20;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const a = Number(lat1), b = Number(lon1), c = Number(lat2), d = Number(lon2);
  if (![a, b, c, d].every(Number.isFinite)) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (c - a) * rad;
  const dLon = (d - b) * rad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function dvfSignal(dpeItem, dvfItems) {
  const target = normalizeAddress(dpeItem.address);
  const targetSurface = Number(dpeItem.surface) || 0;
  const candidates = (dvfItems || []).filter(x => {
    if (!x.address) return false;
    if (target && normalizeAddress(x.address) === target) return true;
    if (dpeItem.lat != null && dpeItem.lon != null && x.latitude != null && x.longitude != null) {
      return haversineKm(dpeItem.lat, dpeItem.lon, x.latitude, x.longitude) <= 0.08;
    }
    return false;
  });

  if (!candidates.length) {
    return { score: 0, label: "aucune mutation DVF rapprochée", yearsSince: null, distanceM: null };
  }

  const best = candidates
    .map(x => ({
      ...x,
      distanceKm: dpeItem.lat != null && dpeItem.lon != null && x.latitude != null && x.longitude != null
        ? haversineKm(dpeItem.lat, dpeItem.lon, x.latitude, x.longitude)
        : Infinity
    }))
    .sort((a, b) => {
      const ay = Number(a.year) || 0, by = Number(b.year) || 0;
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return by - ay;
    })[0];

  const currentYear = new Date().getUTCFullYear();
  const saleYear = Number(best.year) || 0;
  const yearsSince = saleYear ? Math.max(0, currentYear - saleYear) : null;

  // Une vente récente réduit le signal prospectif ; une vente ancienne
  // augmente progressivement le signal sans transformer cela en certitude.
  let score = 0;
  if (yearsSince == null) score = 4;
  else if (yearsSince >= 15) score = 20;
  else if (yearsSince >= 10) score = 16;
  else if (yearsSince >= 6) score = 11;
  else if (yearsSince >= 3) score = 5;

  if (targetSurface && Number(best.built_surface) > 0) {
    const ratio = Number(best.built_surface) / targetSurface;
    if (ratio >= 0.85 && ratio <= 1.15) score += 2;
  }

  return {
    score: Math.min(20, score),
    label: yearsSince == null
      ? "mutation DVF rapprochée"
      : "dernière mutation il y a " + yearsSince + " an(s)",
    yearsSince,
    distanceM: Number.isFinite(best.distanceKm) ? Math.round(best.distanceKm * 1000) : null,
    price: Number(best.price) || 0,
    priceM2: Number(best.price) > 0 && Number(best.built_surface) > 0
      ? Math.round(Number(best.price) / Number(best.built_surface))
      : 0
  };
}

function scoreDataQuality(item) {
  let score = 0;
  if (item.address) score += 3;
  if (item.dpe) score += 2;
  if (item.ges) score += 1;
  if (Number(item.surface) > 0) score += 2;
  if (Number(item.year) > 0) score += 2;
  return score;
}

function buildHiddenOpportunities(dpeItems, currentItems, dvfItems = []) {
  const currentAddresses = new Set(
    currentItems.map(x => normalizeAddress(x.address)).filter(Boolean)
  );

  return dpeItems
    .filter(x => ["F", "G"].includes(x.dpe))
    .filter(x => !currentAddresses.has(normalizeAddress(x.address)))
    .map(x => {
      const dvf = dvfSignal(x, dvfItems);
      const quality = scoreDataQuality(x);
      const rawScore =
        scoreDpe(x.dpe) +
        scoreGes(x.ges) +
        scoreSurface(x.surface) +
        scoreAge(x.year) +
        scoreMarketAbsence() +
        dvf.score +
        quality;

      const score = Math.round(Math.min(100, rawScore));
      const reason = [
        "DPE " + x.dpe,
        x.ges ? "GES " + x.ges : "",
        x.surface ? x.surface + " m²" : "",
        x.year ? "construction " + x.year : "",
        "aucune annonce publique correspondante détectée",
        dvf.label
      ].filter(Boolean);

      if (dvf.priceM2) reason.push("dernier DVF ≈ " + dvf.priceM2.toLocaleString("fr-FR") + " €/m²");

      return {
        id: "hidden:" + Buffer.from(x.address).toString("base64url").slice(0, 50),
        title: "Adresse à vérifier sur le terrain",
        address: x.address,
        city: x.city,
        postcode: x.postcode,
        surface: x.surface,
        dpe: x.dpe,
        ges: x.ges,
        construction_year: x.year,
        property_type: "à qualifier",
        score,
        signal: "DPE " + x.dpe,
        score_breakdown: {
          dpe: scoreDpe(x.dpe),
          ges: scoreGes(x.ges),
          surface: scoreSurface(x.surface),
          age: scoreAge(x.year),
          market_absence: scoreMarketAbsence(),
          dvf_history: dvf.score,
          data_quality: quality
        },
        reason,
        action: "Vérifier l'adresse sur le terrain"
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.score_breakdown.dvf_history || 0) - Number(a.score_breakdown.dvf_history || 0) ||
      Number(b.surface || 0) - Number(a.surface || 0)
    )
    .slice(0, 50);
}


function dvfStats(items) {
  const valid = items.filter(x => number(x.price) > 0 && number(x.built_surface) > 0);
  const prices = valid
    .map(x => x.price / x.built_surface)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let median = 0;
  if (prices.length) {
    const mid = Math.floor(prices.length / 2);
    median = prices.length % 2
      ? prices[mid]
      : (prices[mid - 1] + prices[mid]) / 2;
  }

  const lastYear = new Date().getUTCFullYear() - 1;
  return {
    transactions: items.length,
    comparables: valid.length,
    recent_transactions: items.filter(x => Number(x.year) >= lastYear).length,
    median_price_m2: Math.round(median || 0),
    median_sample: prices.length
  };
}

async function buildMarketSnapshot(params = {}) {
  const city = params.ville || "Charleville-Mézières";
  const [web, open] = await Promise.allSettled([
    searchPublicListings(params),
    fetchOpenDataSignals(city, { dpeLimit: 120, dvfYears: 5, dvfMaxRows: 100000 })
  ]);
  const current = web.status === "fulfilled" ? dedupe(web.value.items || []) : [];
  const items = current.map(item => ({ ...item, property_type: item.property_type || classify(item), market_signal: "annonce_publique" }));
  const openData = open.status === "fulfilled" ? open.value : { dpe: [], dvf: { items: [], total: 0 }, errors: ["Open data indisponible"] };
  const hidden = buildHiddenOpportunities(openData.dpe || [], items, openData.dvf?.items || []);
  const memory = snapshot(items, { sourceReady: web.status === "fulfilled" });
  const market = dvfStats(openData.dvf?.items || []);
  return {
    version: "2.1.0",
    generated_at: new Date().toISOString(),
    scope: { department: params.dept || "08", city, radius_km: number(params.radius_km || 10) },
    counts: { current_listings: items.length, hidden_opportunities: hidden.length, disappeared: memory.disappeared.length, price_changes: memory.priceChanges.length, new_listings: memory.newItems.length },
    market: {
      ...market,
      dvf_period: openData.dvf?.period || null,
      dvf_fetched: openData.dvf?.fetched ?? (openData.dvf?.items || []).length,
      dvf_total_reported: openData.dvf?.total ?? (openData.dvf?.items || []).length,
      dvf_truncated: Boolean(openData.dvf?.truncated),
      dvf_fallback: Boolean(openData.dvf?.fallback)
    },
    source_status: {
      web_public: web.status === "fulfilled",
      dpe: Boolean(openData.dpe?.length),
      dvf: Boolean(openData.dvf?.total),
      dvf_source: openData.dvf?.source || "indisponible"
    },
    errors: [...(web.status === "rejected" ? ["Web public: " + web.reason.message] : []), ...(openData.errors || [])],
    current: items,
    hidden,
    disappeared: memory.disappeared,
    price_changes: memory.priceChanges,
    memory: { size: memory.memorySize, new_listings: memory.newItems.length },
    items,
    next_phase: ["Croisement adresse DPE / historique DVF", "Qualification des doublons multi-sources", "Préparation de tournée terrain", "Historique long terme avec stockage persistant", "Enrichissement progressif des sources publiques"]
  };
}
module.exports = { buildMarketSnapshot };
