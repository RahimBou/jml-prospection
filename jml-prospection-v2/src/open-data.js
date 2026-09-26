const https = require("https");
const zlib = require("zlib");

const DVF_URL = "https://apidf-preprod.cerema.fr/dvf_opendata/mutations/";
const DVF_FALLBACK_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
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

function parseCsvLine(line) {
  const out = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(value); value = ""; }
    else value += ch;
  }
  out.push(value);
  return out;
}

function parseDvfCsv(text, codeInsee, maxRows) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map(clean);
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (row, name) => row[index[name]] ?? "";
  const allowed = new Set(["Vente", "Vente en l'état futur d'achèvement", "Adjudication"]);
  const items = []; const seen = new Set();
  for (let i = 1; i < lines.length && items.length < maxRows; i++) {
    const row = parseCsvLine(lines[i]);
    if (clean(get(row, "code_commune")) !== codeInsee) continue;
    const nature = clean(get(row, "nature_mutation"));
    if (nature && !allowed.has(nature)) continue;
    const id = clean(get(row, "id_mutation")) || String(i);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id, date: clean(get(row, "date_mutation")),
      year: Number(String(get(row, "date_mutation")).slice(0, 4)) || 0,
      price: Number(String(get(row, "valeur_fonciere")).replace(",", ".")) || 0,
      built_surface: Number(String(get(row, "surface_reelle_bati")).replace(",", ".")) || 0,
      land_surface: Number(String(get(row, "surface_terrain")).replace(",", ".")) || 0,
      type: clean(get(row, "type_local")),
      parcel: clean(get(row, "id_parcelle")),
      address: clean([get(row, "adresse_numero"), get(row, "adresse_nom_voie"), get(row, "code_postal"), get(row, "nom_commune")].filter(Boolean).join(" ")),
      latitude: Number(get(row, "latitude")) || null,
      longitude: Number(get(row, "longitude")) || null,
      source: "DVF data.gouv.fr"
    });
  }
  return items;
}


