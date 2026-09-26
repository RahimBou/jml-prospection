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
  return dpe === "G" ? 35 : dpe === "F" ? 28 : dpe === "E" ? 12 : 0;
}
function buildHiddenOpportunities(dpeItems, currentItems) {
  const currentAddresses = new Set(currentItems.map(x => String(x.address || "").toLowerCase()).filter(Boolean));
  return dpeItems
    .filter(x => ["F", "G"].includes(x.dpe))
    .filter(x => !currentAddresses.has(x.address.toLowerCase()))
    .map(x => {
      const score = Math.min(100, 30 + scoreDpe(x.dpe) + (x.surface > 80 ? 8 : 0) + (x.year && x.year < 1980 ? 7 : 0));
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
        reason: ["DPE " + x.dpe, x.surface ? x.surface + " m²" : "", x.year ? "construction " + x.year : "", "aucune annonce publique correspondante détectée"].filter(Boolean),
        action: "Vérifier l'adresse sur le terrain"
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}
function dvfStats(items) {
  const valid = items.filter(x => number(x.price) > 0 && number(x.built_surface) > 0);
  const prices = valid.map(x => x.price / x.built_surface).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const lastYear = new Date().getUTCFullYear() - 1;
  return {
    transactions: items.length,
    comparables: valid.length,
    recent_transactions: items.filter(x => Number(x.year) >= lastYear).length,
    median_price_m2: Math.round(median || 0)
  };
}
async function buildMarketSnapshot(params = {}) {
  const city = params.ville || "Charleville-Mézières";
  const [web, open] = await Promise.allSettled([
    searchPublicListings(params),
    fetchOpenDataSignals(city, { dpeLimit: 120, dvfYears: 5, dvfMaxRows: 1500 })
  ]);
  const current = web.status === "fulfilled" ? dedupe(web.value.items || []) : [];
  const items = current.map(item => ({ ...item, property_type: item.property_type || classify(item), market_signal: "annonce_publique" }));
  const openData = open.status === "fulfilled" ? open.value : { dpe: [], dvf: { items: [], total: 0 }, errors: ["Open data indisponible"] };
  const hidden = buildHiddenOpportunities(openData.dpe || [], items);
  const memory = snapshot(items, { sourceReady: web.status === "fulfilled" });
  const market = dvfStats(openData.dvf?.items || []);
  return {
    version: "2.0.0",
    generated_at: new Date().toISOString(),
    scope: { department: params.dept || "08", city, radius_km: number(params.radius_km || 10) },
    counts: { current_listings: items.length, hidden_opportunities: hidden.length, disappeared: memory.disappeared.length, price_changes: memory.priceChanges.length, new_listings: memory.newItems.length },
    market,
    source_status: { web_public: web.status === "fulfilled", dpe: Boolean(openData.dpe?.length), dvf: Boolean(openData.dvf?.total) },
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
