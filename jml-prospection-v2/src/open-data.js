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
  const numero = first(row, ["ban_housenumber", "numero_rue_ban", "n° voie (ban)", "N° voie (BAN)", "numero_voie_ban", "numero_rue"]);
  const rue = first(row, ["ban_street", "nom_rue_ban", "nom de la rue (ban)", "Nom rue (BAN)", "nom_voie_ban", "nom_rue"]);
  const city = first(row, ["ban_city", "nom_commune_ban", "nom commune (ban)", "Nom commune (BAN)", "nom_commune"]);
  const cp = first(row, ["ban_postcode", "code_postal_ban", "code postal (ban)", "Code postal (BAN)", "code_postal"]);
  return {
    address: clean(first(row, ["ban_label"]) || [numero, rue, cp, city].filter(Boolean).join(" ")),
    city: clean(city), postcode: clean(cp), street: clean(rue), number: clean(numero),
    dpe: clean(first(row, ["classe_bilan_dpe", "etiquette_dpe", "classe_conso_energie", "étiquette dpe", "Etiquette DPE", "classe_dpe"])).toUpperCase(),
    ges: clean(first(row, ["classe_emission_ges", "etiquette_ges", "étiquette ges", "Etiquette GES"])).toUpperCase(),
    surface: Number(first(row, ["surface_habitable_logement", "Surface habitable logement", "surface_habitable", "surface_ventilee"])) || 0,
    year: Number(first(row, ["annee_construction", "Année construction", "annee_construction_batiment"])) || 0,
    lat: Number(first(row, ["ban_y", "coordonnee_cartographique_ban_y", "y_ban"])) || null,
    lon: Number(first(row, ["ban_x", "coordonnee_cartographique_ban_x", "x_ban"])) || null
  };
}

async function fetchDpe(city, limit = 120, codeInsee = "") {
  const size = Math.min(200, Math.max(20, limit));
  const datasets = [
    "dpe-v2-logements-existants",
    "dpe03existant"
  ];

  const queries = [
    codeInsee ? String(codeInsee) : "",
    city ? String(city) : ""
  ].filter(Boolean);

  let lastError = null;

  for (const dataset of datasets) {
    for (const q of queries) {
      try {
        // Recherche textuelle volontairement simple : elle évite de dépendre
        // d'un nom de colonne de filtre qui peut évoluer dans Data Fair.
        const url = "https://data.ademe.fr/data-fair/api/v1/datasets/" +
          dataset + "/lines?size=" + size + "&q=" + encodeURIComponent(q);

        const data = await fetchJson(url, 20000);
        const rows = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);

        const unique = [];
        const seen = new Set();

        for (const row of rows) {
          const item = mapDpe(row);
          if (!item.address || !item.city) continue;

          const normalizedCity = item.city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const wantedCity = String(city || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

          if (wantedCity && !normalizedCity.includes(wantedCity) && !wantedCity.includes(normalizedCity)) {
            continue;
          }

          const key = item.address.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(item);
        }

        if (unique.length) return unique;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("Aucun DPE ADEME trouvé");
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
  const normalized = String(text || "").replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";
  const headers = parseCsvLineWithDelimiter(firstLine, delimiter).map(clean);
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));

  const get = (row, names) => {
    for (const name of names) {
      const idx = index[name];
      if (idx !== undefined && row[idx] !== undefined && clean(row[idx]) !== "") return row[idx];
    }
    return "";
  };

  const wantedCode = String(codeInsee || "").padStart(5, "0");
  const allowed = new Set(["Vente", "Vente en l'état futur d'achèvement", "Adjudication"]);
  const items = [];
  const seen = new Set();

  for (let i = 1; i < lines.length && items.length < maxRows; i++) {
    const row = parseCsvLineWithDelimiter(lines[i], delimiter);
    const rowCode = clean(get(row, ["code_commune", "code commune"]))
      .replace(/^0+(\d{4})$/, "$1")
      .replace(/\.0$/, "")
      .padStart(5, "0");

    if (rowCode !== wantedCode) continue;

    const nature = clean(get(row, ["nature_mutation", "nature mutation"]));
    if (nature && !allowed.has(nature)) continue;

    const id = clean(get(row, ["id_mutation", "id mutation"])) || String(i);
    if (seen.has(id)) continue;
    seen.add(id);

    items.push({
      id,
      date: clean(get(row, ["date_mutation", "date mutation"])),
      year: Number(String(get(row, ["date_mutation", "date mutation"])).slice(0, 4)) || 0,
      price: Number(String(get(row, ["valeur_fonciere", "valeur fonciere"])).replace(",", ".")) || 0,
      built_surface: Number(String(get(row, ["surface_reelle_bati", "surface reelle bati"])).replace(",", ".")) || 0,
      land_surface: Number(String(get(row, ["surface_terrain", "surface terrain"])).replace(",", ".")) || 0,
      type: clean(get(row, ["type_local", "type local"])),
      parcel: clean(get(row, ["id_parcelle", "id parcelle"])),
      address: clean([
        get(row, ["adresse_numero", "adresse numero"]),
        get(row, ["adresse_nom_voie", "adresse nom voie"]),
        get(row, ["code_postal", "code postal"]),
        get(row, ["nom_commune", "nom commune"])
      ].filter(Boolean).join(" ")),
      latitude: Number(String(get(row, ["latitude"])).replace(",", ".")) || null,
      longitude: Number(String(get(row, ["longitude"])).replace(",", ".")) || null,
      source: "DVF data.gouv.fr"
    });
  }
  return items;
}

function parseCsvLineWithDelimiter(line, delimiter) {
  const out = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(value); value = "";
    } else value += ch;
  }
  out.push(value);
  return out;
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

async function fetchDvfFallback(codeInsee, years = 5, maxRows = 100000) {
  const normalizedCode = String(codeInsee || "").padStart(5, "0");
  const dept = normalizedCode.slice(0, 2);
  const currentYear = new Date().getUTCFullYear();
  const maxYear = currentYear - 1;
  const minYear = maxYear - Math.max(1, Math.floor(years)) + 1;
  const yearsToFetch = [];
  for (let y = maxYear; y >= minYear; y--) yearsToFetch.push(y);

  // Priorité au fichier communal officiel : beaucoup plus léger et sans filtrage
  // d'un gros fichier départemental. On conserve le fichier départemental en
  // second secours pour les millésimes où le fichier communal n'est pas publié.
  const results = await Promise.allSettled(yearsToFetch.map(async year => {
    const communeUrl = DVF_FALLBACK_BASE + "/" + year + "/communes/" + dept + "/" + normalizedCode + ".csv";
    try {
      const csv = await fetchBuffer(communeUrl, 30000);
      return parseDvfCsv(csv.toString("utf8"), normalizedCode, maxRows);
    } catch (communeError) {
      const deptUrl = DVF_FALLBACK_BASE + "/" + year + "/departements/" + dept + ".csv.gz";
      const gz = await fetchBuffer(deptUrl, 30000);
      return parseDvfCsv(zlib.gunzipSync(gz).toString("utf8"), normalizedCode, maxRows);
    }
  }));

  const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const unique = []; const seen = new Set();

  for (const item of all) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= maxRows) break;
  }

  if (!unique.length) {
    const failed = results.filter(r => r.status === "rejected").map(r => r.reason?.message || "erreur").slice(0, 3);
    throw new Error("Fallback DVF data.gouv.fr sans transaction" + (failed.length ? " (" + failed.join(" | ") + ")" : ""));
  }

  return {
    total: unique.length,
    fetched: unique.length,
    truncated: false,
    period: { from: minYear, to: maxYear },
    items: unique,
    source: "data.gouv.fr"
  };
}

async function fetchDvf(codeInsee, years = 5, maxRows = 100000) {
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
    fetchDvf(resolved.citycode, options.dvfYears || 5, options.dvfMaxRows || 100000)
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
