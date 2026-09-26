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
function scoreDpe(dpe) {
  return dpe === "G" ? 30 : dpe === "F" ? 22 : dpe === "E" ? 8 : 0;
}

function scoreGes(ges) {
  return ges === "G" ? 12 : ges === "F" ? 9 : ges === "E" ? 5 : 0;
}

function scoreSurface(surface) {
  const s = Number(surface) || 0;
  if (s >= 120 && s <= 220) return 12;
  if (s >= 80 && s < 120) return 9;
  if (s > 220) return 7;
  if (s >= 50) return 5;
  return 0;
}

function scoreAge(year) {
  const y = Number(year) || 0;
  if (!y) return 0;
  if (y < 1950) return 12;
  if (y < 1980) return 9;
  if (y < 2000) return 5;
  return 2;
}

function scoreMarketAbsence() {
  return 12;
}

function buildHiddenOpportunities(dpeItems, currentItems, dvfItems = []) {
  const currentAddresses = new Set(
    currentItems.map(x => String(x.address || "").toLowerCase()).filter(Boolean)
  );
  const dvfYears = dvfItems.map(x => Number(x.year)).filter(Boolean);
  const recentDvfYear = dvfYears.length ? Math.max(...dvfYears) : 0;

  return dpeItems
    .filter(x => ["F", "G"].includes(x.dpe))
    .filter(x => !currentAddresses.has(x.address.toLowerCase()))
    .map(x => {
      const rawScore =
        scoreDpe(x.dpe) +
        scoreGes(x.ges) +
        scoreSurface(x.surface) +
        scoreAge(x.year) +
        scoreMarketAbsence();
      const score = Math.round(Math.min(100, (rawScore / 78) * 100));
      const reason = [
        "DPE " + x.dpe,
        x.ges ? "GES " + x.ges : "",
        x.surface ? x.surface + " m²" : "",
        x.year ? "construction " + x.year : "",
        "aucune annonce publique correspondante détectée"
      ].filter(Boolean);
      if (recentDvfYear) reason.push("marché DVF observé jusqu'en " + recentDvfYear);

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
          market_absence: scoreMarketAbsence()
        },
        reason,
        action: "Vérifier l'adresse sur le terrain"
      };
    })
    .sort((a, b) => b.score - a.score || Number(b.surface || 0) - Number(a.surface || 0))
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
