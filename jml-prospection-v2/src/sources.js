const https = require("https");

function fetchText(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "JML-Prospection-V2/2.0 (+public-data)",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"
      }
    }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchText(new URL(res.headers.location, url).toString(), timeout).then(resolve, reject);
        }
        if (res.statusCode >= 400) return reject(new Error("HTTP " + res.statusCode));
        resolve(data);
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
  });
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ""; }
}

function extractLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = absoluteUrl(m[1], base);
    const text = clean(m[2].replace(/<[^>]+>/g, " "));
    if (href) out.push({ href, text });
  }
  return out;
}

function extractPrice(text) {
  const m = text.match(/(\d[\d\s\u00a0]{3,})\s*€/);
  return m ? Number(m[1].replace(/[\s\u00a0]/g, "")) : 0;
}

function extractSurface(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*m(?:²|2)\b/i);
  return m ? Number(m[1].replace(",", ".")) : 0;
}

function extractRooms(text) {
  const m = text.match(/\b(\d{1,2})\s*(?:pi[eè]ces?|p|chambres?)\b/i);
  return m ? Number(m[1]) : 0;
}

function isSpecificListing(title, url, text) {
  const t = clean(title).toLowerCase();
  const generic = /^(annonces? immobili[eè]res?|nos annonces|nos biens|vente de maisons?|vente d'appartements?|immobilier|accueil|contact|estimation|recherche)$/i.test(t);
  const hasSignal = extractPrice(text) > 0 || extractSurface(text) > 0 || extractRooms(text) > 0;
  const detailUrl = /\/(?:annonce|annonces|bien|biens|vente|property|listing)\//i.test(url);
  return !generic && (hasSignal || detailUrl);
}

const DEFAULT_SITES = [
  "https://www.bayardhabitat.fr/",
  "https://www.rimbaudimmo.fr/",
  "https://www.agence-ing.fr/",
  "https://www.ill-immobilier.fr/",
  "https://www.justimmo08.fr/",
  "https://www.toutabitat.com/",
  "https://www.pergent-immobilier.com/",
  "https://www.fischer-immobilier.fr/",
  "https://www.bressy-immobilier.com/"
];

async function searchSite(home, params) {
  const html = await fetchText(home);
  const links = extractLinks(html, home);
  const wanted = links
    .filter(x => isSpecificListing(x.text, x.href, x.text))
    .slice(0, 30);

  const items = [];
  for (const link of wanted) {
    let detail = link.text;
    try {
      const page = await fetchText(link.href, 8000);
      detail = clean(page.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    } catch {}

    if (!isSpecificListing(link.text, link.href, detail)) continue;
    const text = clean((link.text + " " + detail).slice(0, 12000));
    items.push({
      id: "web:" + Buffer.from(link.href).toString("base64url").slice(0, 40),
      source: "Web public local",
      agency: new URL(home).hostname.replace(/^www\./, ""),
      title: clean(link.text) || "Bien immobilier",
      external_url: link.href,
      price: extractPrice(text),
      surface: extractSurface(text),
      rooms: extractRooms(text),
      address: "",
      city: params.ville || "",
      location_text: text,
      department: params.dept || "08"
    });
  }
  return items;
}

async function searchPublicListings(params = {}) {
  const sites = DEFAULT_SITES.slice(0, Math.max(3, Math.min(9, Number(params.web_sources || 9))));
  const settled = await Promise.allSettled(sites.map(site => searchSite(site, params)));
  const rawItems = settled.flatMap(x => x.status === "fulfilled" ? x.value : []);
  const cityNeedle = String(params.ville || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cityAliases = cityNeedle.includes("charleville")
    ? ["charleville-mezieres", "charleville", "08000"]
    : [cityNeedle];

  // Pour Charleville-Mézières, les pages d'agences contiennent souvent
  // "proche Charleville", "extérieur Charleville" ou une liste de communes
  // dans leur texte SEO. On ne doit pas transformer ces biens voisins en
  // biens de Charleville-Mézières.
  const charlevilleExcluded = [
    "sedan", "givet", "tournes", "rimogne", "signy-labbaye", "signy-labbaye",
    "nouzonville", "montherme", "bogny-sur-meuse", "renwez", "fagnon",
    "prix-les-mezieres", "montcy-notre-dame", "warcq", "aiglemont",
    "saint-laurent", "la-francheville", "villers-semeuse", "les-ayvelles",
    "vivier-au-court", "floing", "donchery", "ham-les-moines"
  ];

  const normalizeText = value =>
    String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const items = rawItems.filter(item => {
    const title = String(item.title || "");
    const location = String(item.location_text || "");
    const titleNorm = normalizeText(title);
    const full = normalizeText(title + " " + location);

    const postcodeMatches = full.match(/\b(0[0-9]\d{3})\b/g) || [];
    const hasWrongPostcode = cityNeedle.includes("charleville")
      ? postcodeMatches.some(cp => cp !== "08000")
      : false;

    if (hasWrongPostcode) return false;

    if (cityNeedle.includes("charleville")) {
      // Les mentions de proximité/extérieur sont explicitement hors commune.
      if (/\b(proche|exterieur|exterieur de|banlieue|alentours|a proximite de)\b/.test(titleNorm)) {
        return false;
      }

      // Un titre du type "20 km / 200 km de Charleville" décrit une distance,
      // pas un bien situé dans la commune. On l'exclut du flux local.
      if (/\b\d{1,3}\s*km(?:s)?\b/.test(titleNorm)) {
        return false;
      }

      // Si le titre nomme clairement une commune voisine, on l'exclut même
      // si la page contient "Charleville" dans son texte commercial.
      if (charlevilleExcluded.some(name => titleNorm.includes(name))) {
        return false;
      }

      // Les exclusivités d'agence ne doivent pas entrer dans la prospection
      // multi-sources : elles sont déjà confiées à une agence et ne constituent
      // pas une opportunité de prospection pour nous.
      if (/\b(exclusivite|exclusivite agence|bien en exclusivite|exclusivite chez)\b/.test(full)) {
        return false;
      }

      // Une adresse/titre Charleville ou un code postal 08000 est une preuve
      // directe. Sinon, on n'utilise plus le simple texte SEO de la page.
      const directCity = /\b08000\b/.test(titleNorm) ||
        /charleville[- ]mezieres/.test(titleNorm) ||
        /\bcharleville\b/.test(titleNorm);

      return directCity;
    }

    const titleHasCity = cityAliases.some(alias => titleNorm.includes(alias));
    return titleHasCity;
  });

  const seen = new Set();
  const unique = items.filter(item => {
    const key = item.external_url || (item.title + "|" + item.price + "|" + item.surface);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    source: "Web public local",
    version: "2.3.1",
    total: unique.length,
    items: unique,
    sources: sites.map((site, i) => ({
      site,
      ok: settled[i].status === "fulfilled",
      count: settled[i].status === "fulfilled" ? settled[i].value.length : 0
    }))
  };
}

async function geocodeAddress(query) {
  const endpoint = "https://data.geopf.fr/geocodage/search/?q=" + encodeURIComponent(query) + "&limit=5";
  const raw = await fetchText(endpoint);
  const json = JSON.parse(raw);
  return {
    query,
    items: Array.isArray(json.features) ? json.features.map(f => ({
      label: f.properties?.label || "",
      city: f.properties?.city || "",
      postcode: f.properties?.postcode || "",
      lon: f.geometry?.coordinates?.[0] ?? null,
      lat: f.geometry?.coordinates?.[1] ?? null
    })) : []
  };
}

module.exports = { searchPublicListings, geocodeAddress };
