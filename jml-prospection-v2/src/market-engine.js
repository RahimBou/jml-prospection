const { searchPublicListings } = require("./sources");
const { fetchOpenDataSignals } = require("./open-data");
const { snapshot } = require("./memory");
const { buildSectorRadar } = require("./sector-radar");

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
    return { score: 0, label: "aucune mutation DVF rapprochée", yearsSince: null, distanceM: null, matchType: null };
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
    matchType: target && normalizeAddress(best.address) === target ? "exact" : "geographique",
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

function scoreSellerDpe(dpe) {
  // Le DPE est un signal, pas une preuve de vente : poids volontairement plafonné.
  return dpe === "G" ? 10 : dpe === "F" ? 8 : dpe === "E" ? 4 : dpe === "D" ? 1 : 0;
}

function scoreSellerGes(ges) {
  return ges === "G" ? 4 : ges === "F" ? 3 : ges === "E" ? 1 : 0;
}

function scoreLocalActivity(count) {
  // On récompense une vraie activité locale, sans transformer un quartier dense
  // en machine à faux positifs.
  const n = Number(count) || 0;
  if (n >= 8) return 5;
  if (n >= 5) return 4;
  if (n >= 3) return 3;
  if (n >= 1) return 1;
  return 0;
}

function scoreHold(yearsSince) {
  const y = Number(yearsSince);
  if (!Number.isFinite(y) || y < 2) return 0;
  // Progression continue pour éviter que plusieurs adresses très proches
  // reçoivent exactement le même score à cause de seuils trop larges.
  // Le signal plafonne à 18 : la durée seule ne doit jamais décider.
  return Math.min(18, Math.round(y * 1.5));
}

function scoreMatchType(matchType) {
  return matchType === "exact" ? 8 : matchType === "geographique" ? 3 : 0;
}

function sellerBand(score) {
  const s = Number(score || 0);
  if (s >= 72) return "fort";
  if (s >= 58) return "probable";
  if (s >= 42) return "surveiller";
  return "faible";
}

function sellerBandLabel(band) {
  return ({
    fort: "Signal vendeur fort",
    probable: "Signal vendeur probable",
    surveiller: "À surveiller",
    faible: "Signal faible"
  })[band] || "À surveiller";
}

function buildHiddenOpportunities(dpeItems, currentItems, dvfItems = []) {
  const currentAddresses = new Set(
    currentItems.map(x => normalizeAddress(x.address)).filter(Boolean)
  );

  return dpeItems
    .filter(x => x.address)
    .filter(x => !currentAddresses.has(normalizeAddress(x.address)))
    .map(x => {
      const dvf = dvfSignal(x, dvfItems);
      const quality = scoreDataQuality(x);
      const localTransactions = (dvfItems || []).filter(t => isResidentialDvf(t)).filter(t => {
        if (x.lat == null || x.lon == null || t.latitude == null || t.longitude == null) return false;
        return haversineKm(x.lat, x.lon, t.latitude, t.longitude) <= 0.15;
      }).length;

      const hold = scoreHold(dvf.yearsSince);
      const dpeScore = scoreSellerDpe(x.dpe);
      const gesScore = scoreSellerGes(x.ges);
      const ageScore = Math.min(8, scoreAge(x.year));
      const surfaceScore = Math.min(5, scoreSurface(x.surface));
      const qualityScore = Math.min(6, quality);
      const activityScore = scoreLocalActivity(localTransactions);
      const matchScore = scoreMatchType(dvf.matchType);

      const signals = [];
      if (["F", "G"].includes(x.dpe)) signals.push("DPE énergivore");
      if (["F", "G"].includes(x.ges)) signals.push("GES élevé");
      if (dvf.yearsSince >= 6) signals.push("détention longue");
      if (dvf.yearsSince >= 9) signals.push("cycle de détention avancé");
      if (localTransactions >= 3) signals.push("marché local actif");
      if (Number(x.year) > 0 && Number(x.year) < 1970) signals.push("bâti ancien");
      if (dvf.matchType === "exact") signals.push("DVF même adresse");
      else if (dvf.matchType === "geographique") signals.push("DVF à proximité");
      if (quality >= 8) signals.push("données bien confirmées");
      if (!currentAddresses.has(normalizeAddress(x.address))) signals.push("aucune annonce détectée");

      // Base volontairement modérée : la différence vient surtout des combinaisons.
      let score =
        dpeScore +
        gesScore +
        ageScore +
        surfaceScore +
        hold +
        activityScore +
        matchScore +
        qualityScore +
        2; // absence d'annonce : signal faible tant que la couverture web n'est pas exhaustive

      const synergies = [];
      if (hold >= 12 && ["F", "G"].includes(x.dpe)) {
        score += 10;
        synergies.push("détention longue + DPE énergivore");
      }
      if (hold >= 12 && Number(x.year) > 0 && Number(x.year) < 1970) {
        score += 8;
        synergies.push("détention longue + bâti ancien");
      }
      if (hold >= 6 && localTransactions >= 3) {
        score += 6;
        synergies.push("détention longue + marché local actif");
      }
      if (dvf.matchType === "exact" && hold >= 6) {
        score += 6;
        synergies.push("même adresse DVF + détention longue");
      }
      if (dvf.matchType === "exact" && ["F", "G"].includes(x.dpe) && hold >= 6) {
        score += 5;
        synergies.push("DVF exact + DPE énergivore + détention");
      }
      if (Number(x.year) > 0 && Number(x.year) < 1970 && ["F", "G"].includes(x.dpe)) {
        score += 4;
        synergies.push("bâti ancien + DPE énergivore");
      }

      // Bonus de convergence : plusieurs familles indépendantes valent davantage
      // que plusieurs signaux provenant de la même famille.
      const families = [
        ["energie", ["F", "G"].includes(x.dpe) || ["F", "G"].includes(x.ges)],
        ["detention", hold >= 6],
        ["historique", Boolean(dvf.matchType)],
        ["marche", localTransactions >= 3],
        ["bati", Number(x.year) > 0 && Number(x.year) < 1970],
        ["donnees", quality >= 8]
      ].filter(([, ok]) => ok).length;

      if (families >= 5) {
        score += 8;
        synergies.push("convergence de 5 familles de signaux");
      } else if (families >= 4) {
        score += 5;
        synergies.push("convergence de 4 familles de signaux");
      } else if (families >= 3) {
        score += 2;
      }

      // Filtre "terrain renforcé" : on ne présente pas comme vendeur probable
      // un bien reposant uniquement sur des indices faibles. Ce filtre ne garantit
      // jamais une vente : il sélectionne les dossiers qui méritent une prospection.
      const terrainReady =
        (dvf.matchType === "exact" && hold >= 6 && (
          ["F", "G"].includes(x.dpe) ||
          ["F", "G"].includes(x.ges) ||
          Number(x.year) > 0 && Number(x.year) < 1970 ||
          localTransactions >= 3
        )) ||
        (dvf.matchType === "exact" && hold >= 9);

      if (terrainReady) {
        score += 5;
        synergies.push("dossier terrain renforcé");
      } else {
        score = Math.min(score, 57);
      }

      // Micro-différenciation fondée sur des éléments déjà observés.
      // Elle sert à départager les dossiers proches sans transformer le score
      // en prétendue probabilité de vente.
      const evidencePrecision =
        (dvf.matchType === "exact" ? 1 : 0) +
        (dvf.yearsSince >= 10 ? 1 : dvf.yearsSince >= 6 ? 0.5 : 0) +
        (localTransactions >= 5 ? 1 : localTransactions >= 3 ? 0.5 : 0) +
        (quality >= 9 ? 1 : quality >= 7 ? 0.5 : 0) +
        (["F","G"].includes(x.dpe) && Number(x.year) < 1970 ? 1 : 0);
      score += Math.min(4, evidencePrecision);
      score = Math.round(Math.min(100, score));
      const band = sellerBand(score);

      const reason = [
        "Indice vendeur basé sur " + signals.length + " signaux",
        "convergence : " + families + " familles indépendantes",
        "DPE " + (x.dpe || "non renseigné"),
        x.ges ? "GES " + x.ges : "",
        x.surface ? x.surface + " m²" : "",
        x.year ? "construction " + x.year : "",
        dvf.label,
        dvf.matchType === "exact" ? "DVF même adresse" : dvf.matchType === "geographique" ? "DVF à proximité" : "",
        localTransactions ? localTransactions + " mutation(s) DVF dans ~150 m" : "",
        "aucune annonce publique correspondante détectée",
        ...synergies
      ].filter(Boolean);

      if (dvf.priceM2) reason.push("dernier DVF ≈ " + dvf.priceM2.toLocaleString("fr-FR") + " €/m²");

      return {
        id: "hidden:" + Buffer.from(x.address).toString("base64url").slice(0, 50),
        title: sellerBandLabel(band),
        address: x.address,
        city: x.city,
        postcode: x.postcode,
        lat: Number.isFinite(Number(x.lat)) ? Number(x.lat) : null,
        lon: Number.isFinite(Number(x.lon)) ? Number(x.lon) : null,
        surface: x.surface,
        dpe: x.dpe,
        ges: x.ges,
        construction_year: x.year,
        property_type: "à qualifier",
        score,
        terrain_ready: terrainReady,
        qualification: terrainReady
          ? "Candidat terrain renforcé — plusieurs indices concordants"
          : "Veille — indices insuffisants pour une prospection prioritaire",
        seller_signal: band,
        seller_signal_label: sellerBandLabel(band),
        signal_count: signals.length,
        family_count: families,
        signal_details: signals,
        synergies,
        local_dvf_transactions: localTransactions,
        signal: "Indice vendeur multi-signaux",
        score_breakdown: {
          dpe: dpeScore,
          ges: gesScore,
          surface: surfaceScore,
          age: ageScore,
          market_absence: 2,
          dvf_history: hold + matchScore,
          local_activity: activityScore,
          data_quality: qualityScore,
          convergence: Math.min(8, families >= 5 ? 8 : families >= 4 ? 5 : families >= 3 ? 2 : 0)
        },
        reason,
        action: "Vérifier l'adresse sur le terrain"
      };
    })
    .sort((a, b) =>
      Number(b.score || 0) - Number(a.score || 0) ||
      Number(b.family_count || 0) - Number(a.family_count || 0) ||
      Number(b.signal_count || 0) - Number(a.signal_count || 0)
    );
}
function isResidentialDvf(item) {
  const t = String(item?.type || "").toLowerCase();
  return /maison|appartement|studio|immeuble d'habitation|local d'habitation/.test(t);
}

function dvfStats(items) {
  const residential = items.filter(isResidentialDvf);
  const valid = residential.filter(x => number(x.price) > 0 && number(x.built_surface) > 0);
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
    transactions: residential.length,
    all_mutations: items.length,
    comparables: valid.length,
    recent_transactions: residential.filter(x => Number(x.year) >= lastYear).length,
    median_price_m2: Math.round(median || 0),
    median_sample: prices.length
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + " — délai dépassé")), ms))
  ]);
}

async function buildMarketSnapshot(params = {}) {
  const city = params.ville || "Charleville-Mézières";
  // Le Radar doit rester utilisable même si une source publique ralentit.
  // Render peut retourner 502 lorsqu'une requête reste trop longtemps en amont.
  const [web, open] = await Promise.allSettled([
    withTimeout(searchPublicListings(params), 35000, "Collecte annonces publiques"),
    withTimeout(fetchOpenDataSignals(city, { dpeLimit: 800, dvfYears: 5, dvfMaxRows: 100000 }), 45000, "Collecte DVF/DPE")
  ]);
  const current = web.status === "fulfilled" ? dedupe(web.value.items || []) : [];
  const items = current.map(item => ({ ...item, property_type: item.property_type || classify(item), market_signal: "annonce_publique" }));
  const openData = open.status === "fulfilled" ? open.value : { dpe: [], dvf: { items: [], total: 0 }, errors: ["Open data indisponible"] };
  const hidden = buildHiddenOpportunities(openData.dpe || [], items, openData.dvf?.items || []);
  const memory = snapshot(items, { sourceReady: web.status === "fulfilled" });
  const market = dvfStats(openData.dvf?.items || []);
  const sectorRadar = buildSectorRadar({
    dpe: openData.dpe || [],
    dvf: openData.dvf?.items || [],
    current: items,
    hidden
  });
  return {
    version: "2.4.0",
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
    sector_radar: sectorRadar,
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
    memory: { size: memory.memorySize, new_listings: memory.newItems.length, new_items: memory.newItems },
    items,
    next_phase: ["Croisement adresse DPE / historique DVF", "Qualification des doublons multi-sources", "Préparation de tournée terrain", "Historique long terme avec stockage persistant", "Enrichissement progressif des sources publiques"]
  };
}
module.exports = { buildMarketSnapshot };
