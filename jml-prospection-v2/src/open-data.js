const https = require("https");

const DVF_URL = "https://apidf-preprod.cerema.fr/dvf_opendata/mutations/";
const DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines";
const BAN_URL = "https://data.geopf.fr/geocodage/search/";

function fetchJson(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "JML-Prospection-V2/2.0 (+public-open-data)",
        "Accept": "application/json"
      }
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => body += c);
      res.on("end", () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchJson(new URL(res.headers.location, url).toString(), timeout).then(resolve, reject);
        }
        if (res.statusCode >= 400) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch { reject(new Error("JSON invalide")); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
  });
}

function clean(v) {
  return String(v ?? "").replace(/\\s+/g, " ").trim();
}

function first(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return "";
}

async function resolveCity(city) {
  const q = clean(city);
  if (!q) return null;
  const url = BAN_URL + "?q=" + encodeURIComponent(q) + "&type=municipality&limit=5";
  const data = await fetchJson(url);
  const feature = Array.isArray(data.features) ? data.features.find(f => f.properties?.city) : null;
  if (!feature) return null;
  const p = feature.properties || {};
  return {
    city: p.city || q,
    postcode: p.postcode || "",
    citycode: p.citycode || "",
    lon: feature.geometry?.coordinates?.[0] ?? null,
    lat: feature.geometry?.coordinates?.[1] ?? null
  };
}

function mapDpe(row) {
  const numero = first(row, ["numero_rue_ban", "n° voie (ban)", "numero_voie_ban", "numero_rue"]);
  const rue = first(row, ["nom_rue_ban", "nom de la rue (ban)", "nom_voie_ban", "nom_rue"]);
  const city = first(row, ["nom_commune_ban", "nom commune (ban)", "nom_commune"]);
  const cp = first(row, ["code_postal_ban", "code postal (ban)", "code_postal"]);
  const label = clean([numero, rue, cp, city].filter(Boolean).join(" "));
  return {
    address: label,
    city: clean(city),
    postcode: clean(cp),
    street: clean(rue),
    number: clean(numero),
    dpe: clean(first(row, ["etiquette_dpe", "étiquette dpe", "classe_consommation_energie", "classe_dpe"])).toUpperCase(),
    ges: clean(first(row, ["etiquette_ges", "étiquette ges", "classe_emission_ges"])).toUpperCase(),
    surface: Number(first(row, ["surface_habitable_logement", "surface_habitable", "surface_ventilee"])) || 0,
    year: Number(first(row, ["annee_construction", "annee_construction_batiment"])) || 0,
    lat: Number(first(row, ["coordonnee_cartographique_ban_x", "x_ban"])) || null,
    lon: Number(first(row, ["coordonnee_cartographique_ban_y", "y_ban"])) || null
  };
}

async function fetchDpe(city, limit = 120) {
  const url = DPE_URL + "?q=" + encodeURIComponent(city) + "&size=" + Math.min(200, Math.max(20, limit));
  const data = await fetchJson(url, 20000);
  const rows = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
  const items = rows.map(mapDpe).filter(x => x.address && x.city);
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

async function fetchDvf(codeInsee, years = 5, maxRows = 1500) {
  if (!codeInsee) return { items: [], total: 0 };
  const currentYear = new Date().getUTCFullYear();
  const params = new URLSearchParams({
    code_insee: codeInsee,
    anneemut_min: String(currentYear - Math.max(1, years)),
    page_size: "500",
    page: "1"
  });
  const items = [];
  let next = DVF_URL + "?" + params.toString();
  let pages = 0;
  while (next && items.length < maxRows && pages < 4) {
    const data = await fetchJson(next, 20000);
    const rows = Array.isArray(data.results) ? data.results : [];
    items.push(...rows);
    next = data.next || "";
    pages++;
  }
  return {
    total: Number(items.length),
    items: items.slice(0, maxRows).map(row => ({
      id: row.idmutation,
      date: row.datemut || "",
      year: Number(row.anneemut) || 0,
      price: Number(row.valeurfonc) || 0,
      built_surface: Number(row.sbati) || 0,
      land_surface: Number(row.sterr) || 0,
      type: clean(row.libtypbien),
      parcel: Array.isArray(row.l_idpar) ? row.l_idpar[0] : clean(row.l_idpar),
      citycode: Array.isArray(row.l_codinsee) ? row.l_codinsee[0] : clean(row.l_codinsee)
    }))
  };
}

async function fetchOpenDataSignals(city, options = {}) {
  const resolved = await resolveCity(city);
  if (!resolved?.citycode) {
    return { city: resolved || { city }, dpe: [], dvf: { items: [], total: 0 }, errors: ["Commune introuvable"] };
  }

  const [dpe, dvf] = await Promise.allSettled([
    fetchDpe(resolved.city, options.dpeLimit || 120),
    fetchDvf(resolved.citycode, options.dvfYears || 5, options.dvfMaxRows || 1500)
  ]);

  return {
    city: resolved,
    dpe: dpe.status === "fulfilled" ? dpe.value : [],
    dvf: dvf.status === "fulfilled" ? dvf.value : { items: [], total: 0 },
    errors: [
      ...(dpe.status === "rejected" ? ["DPE: " + dpe.reason.message] : []),
      ...(dvf.status === "rejected" ? ["DVF: " + dvf.reason.message] : [])
    ]
  };
}

module.exports = { resolveCity, fetchDpe, fetchDvf, fetchOpenDataSignals };
