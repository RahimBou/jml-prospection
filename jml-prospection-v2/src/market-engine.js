const { searchPublicListings } = require("./sources");

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = [
      item.external_url || "",
      String(item.title || "").toLowerCase(),
      number(item.price),
      number(item.surface)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classify(item) {
  const title = String(item.title || "").toLowerCase();
  if (/terrain/.test(title)) return "terrain";
  if (/appartement|studio/.test(title)) return "appartement";
  if (/immeuble/.test(title)) return "immeuble";
  if (/garage|parking/.test(title)) return "garage-parking";
  if (/commerce|local commercial|boutique/.test(title)) return "commerce";
  return "maison";
}

async function buildMarketSnapshot(params = {}) {
  const current = await searchPublicListings(params);
  const items = dedupe(current.items || []).map(item => ({
    ...item,
    property_type: item.property_type || classify(item),
    market_signal: "annonce_publique"
  }));

  const byType = {};
  for (const item of items) byType[item.property_type] = (byType[item.property_type] || 0) + 1;

  return {
    version: "2.0.0",
    generated_at: new Date().toISOString(),
    scope: {
      department: params.dept || "08",
      city: params.ville || "Charleville-Mézières",
      radius_km: number(params.radius_km || 10)
    },
    counts: {
      current_listings: items.length,
      hidden_opportunities: 0,
      disappeared: 0,
      price_changes: 0
    },
    by_type: byType,
    items,
    next_phase: [
      "Mémoire persistante des annonces",
      "Détection des annonces disparues",
      "Détection des baisses de prix",
      "Croisement DVF + DPE pour signaux de terrain",
      "Classement Top 10 à visiter"
    ]
  };
}

module.exports = { buildMarketSnapshot };
