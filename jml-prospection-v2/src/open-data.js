const https = require("https");
const zlib = require("zlib");

const DVF_URL = "https://apidf.cerema.fr/dvf_opendata/mutations/";
const DVF_FALLBACK_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines";
const BAN_URL = "https://data.geopf.fr/geocodage/search/";

function fetchBuffer(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "JML-Prospection-V2/2.0 (+public-open-data)", "Accept": "*/*" }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchBuffer(new URL(res.headers.location, url).toString(), timeout).then(resolve, reject);
        }
        if (res.statusCode >= 400) return reject(new Error("HTTP " + res.statusCode));
        resolve(Buffer.concat(chunks));
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
  });
}

async function fetchJson(url, timeout = 15000) {
  const body = await fetchBuffer(url, timeout);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new Error("JSON invalide"); }
}

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
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
  const data = await fetchJson(BAN_URL + "?q=" + encodeURIComponent(q) + "&type=municipality&limit=5");
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
  const numero = first(row, ["numero_rue_ban", "n° voie (ban)", "N° voie (BAN)", "numero_voie_ban", "numero_rue"]);
  const rue = first(row, ["nom_rue_ban", "nom de la rue (ban)", "Nom rue (BAN)", "nom_voie_ban", "nom_rue"]);
  const city = first(row, ["nom_commune_ban", "nom commune (ban)", "Nom commune (BAN)", "nom_commune"]);
  const cp = first(row, ["code_postal_ban", "code postal (ban)", "Code postal (BAN)", "code_postal"]);
  return {
    address: clean([numero, rue, cp, city].filter(Boolean).join(" ")),
    city: clean(city), postcode: clean(cp), street: clean(rue), number: clean(numero),
    dpe: clean(first(row, ["etiquette_dpe", "étiquette dpe", "Etiquette DPE", "classe_consommation_energie", "classe_dpe"])).toUpperCase(),
    ges: clean(first(row, ["etiquette_ges", "étiquette ges", "Etiquette GES", "classe_emission_ges"])).toUpperCase(),
    surface: Number(first(row, ["surface_habitable_logement", "Surface habitable logement", "surface_habitable", "surface_ventilee"])) || 0,
    year: Number(first(row, ["annee_construction", "Année construction", "annee_construction_batiment"])) || 0,
    lat: Number(first(row, ["coordonnee_cartographique_ban_x", "x_ban"])) || null,
    lon: Number(first(row, ["coordonnee_cartographique_ban_y", "y_ban"])) || null
  };
}

async function fetchDpe(city, limit = 120, codeInsee = "") {
  const query = codeInsee ? "&q_fields=" + encodeURIComponent("Code_INSEE_(BAN)") + "&q=" + encodeURIComponent(codeInsee) : "&q=" + encodeURIComponent(city);
  const data = await fetchJson(DPE_URL + "?" + query.slice(1) + "&size=" + Math.min(200, Math.max(20, limit)), 20000);
  const rows = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
  const unique = []; const seen = new Set();
  for (const row of rows) {
    const item = mapDpe(row);
    if (!item.address || !item.city) continue;
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); unique.push(item);
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
  const lines = text.split(/\\r?\\n/).filter(Boolean);
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
      type: clean(get(row, "type_local")), parcel: clean(get(row, "id_parcelle")),
      address: clean([get(row, "adresse_numero"), get(row, "adresse_nom_voie"), get(row, "code_postal"), get(row, "nom_commune")].filter(Boolean).join(" ")),
      latitude: Number(get(row, "latitude")) || null, longitude: Number(get(row, "longitude")) || null,
      source: "DVF data.gouv.fr"
    });
  }
  return items;
}

async function fetchDvfCerema(codeInsee, years = 5, maxRows = 10000) {
  const currentYear = new Date().getUTCFullYear();
  const fullYears = Math.max(1, Math.floor(years));
  const maxYear = currentYear - 1;
  const minYear = maxYear - fullYears + 1;
  const params = new URLSearchParams({
    code_insee: codeInsee,
    anneemut_min: String(minYear),
    anneemut_max: String(maxYear),
    page_size: "500",
    page: "1"
  });

  const items = [];
  const seen = new Set();
  let next = DVF_URL + "?" + params.toString();
  let pages = 0;
  let apiTotal = null;

  while (next && items.length < maxRows && pages < 30) {
    const data = await fetchJson(next, 20000);
    if (apiTotal === null) {
      const candidate = Number(data.count ?? data.total ?? data.total_count);
      if (Number.isFinite(candidate)) apiTotal = candidate;
    }

    const rows = Array.isArray(data.results) ? data.results : [];
    for (const row of rows) {
      const id = clean(row.idmutation || row.idopendata);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(row);
      if (items.length >= maxRows) break;
    }

    next = data.next || "";
    pages++;
  }

  const truncated = Boolean(next) || (apiTotal !== null && apiTotal > items.length);

  return {
    total: apiTotal !== null ? apiTotal : items.length,
    fetched: items.length,
    truncated,
    period: { from: minYear, to: maxYear },
    items: items.map(row => ({
      id: row.idmutation || row.idopendata, date: row.datemut || "",
      year: Number(row.anneemut) || 0, price: Number(row.valeurfonc) || 0,
      built_surface: Number(row.sbati) || 0, land_surface: Number(row.sterr) || 0,
      type: clean(row.libtypbien),
      parcel: Array.isArray(row.l_idpar) ? row.l_idpar[0] : clean(row.l_idpar),
      citycode: Array.isArray(row.l_codinsee) ? row.l_codinsee[0] : clean(row.l_codinsee),
      source: "DVF+ Cerema"
    }))
  };
}

async function fetchDvfFallback(codeInsee, years = 5, maxRows = 10000) {
  const dept = codeInsee.slice(0, 2);
  const currentYear = new Date().getUTCFullYear();
  const maxYear = currentYear - 1;
  const minYear = maxYear - Math.max(1, Math.floor(years)) + 1;
  const yearsToFetch = [];
  for (let y = maxYear; y >= minYear; y--) yearsToFetch.push(y);

  const results = await Promise.allSettled(yearsToFetch.map(async year => {
    const url = DVF_FALLBACK_BASE + "/" + year + "/departements/" + dept + ".csv.gz";
    const gz = await fetchBuffer(url, 30000);
    return parseDvfCsv(zlib.gunzipSync(gz).toString("utf8"), codeInsee, maxRows);
  }));

  const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const unique = []; const seen = new Set();
  for (const item of all) {
    if (seen.has(item.id)) continue;
    seen.add(item.id); unique.push(item);
    if (unique.length >= maxRows) break;
  }
  if (!unique.length) throw new Error("Fallback DVF data.gouv.fr sans transaction");
  return {
    total: unique.length,
    fetched: unique.length,
    truncated: false,
    period: { from: minYear, to: maxYear },
    items: unique,
    source: "data.gouv.fr"
  };
}

async function fetchDvf(codeInsee, years = 5, maxRows = 10000) {
  try {
    const result = await fetchDvfCerema(codeInsee, years, maxRows);
    if (result.total > 0) return { ...result, source: "Cerema", fallback: false };
    throw new Error("Cerema a renvoyé 0 transaction");
  } catch (ceremaError) {
    const fallback = await fetchDvfFallback(codeInsee, years, maxRows);
    return { ...fallback, fallback: true, errors: ["Cerema DVF indisponible: " + ceremaError.message] };
  }
}

async function fetchOpenDataSignals(city, options = {}) {
  const resolved = await resolveCity(city);
  if (!resolved?.citycode) {
    return { city: resolved || { city }, dpe: [], dvf: { items: [], total: 0 }, errors: ["Commune introuvable"] };
  }

  const [dpe, dvf] = await Promise.allSettled([
    fetchDpe(resolved.city, options.dpeLimit || 120, resolved.citycode),
    fetchDvf(resolved.citycode, options.dvfYears || 5, options.dvfMaxRows || 10000)
  ]);
  const dvfValue = dvf.status === "fulfilled" ? dvf.value : { items: [], total: 0, source: "indisponible" };

  return {
    city: resolved,
    dpe: dpe.status === "fulfilled" ? dpe.value : [],
    dvf: dvfValue,
    errors: [
      ...(dpe.status === "rejected" ? ["DPE: " + dpe.reason.message] : []),
      ...(dvf.status === "rejected" ? ["DVF: " + dvf.reason.message] : []),
      ...(dvf.status === "fulfilled" && dvf.value.errors ? dvf.value.errors : [])
    ]
  };
}

module.exports = { resolveCity, fetchDpe, fetchDvf, fetchOpenDataSignals };
