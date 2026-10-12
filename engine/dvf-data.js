"use strict";

function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = [";", ",", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(v => v !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || "").trim()])));
}
function pick(row, ...names) {
  const wanted = new Set(names.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) && value !== "") return value;
  }
  return "";
}
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function normalizeDvfRows(rows) {
  const byMutation = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const mutationId = String(pick(row, "id_mutation", "idmutation", "id_mutation") || "").trim();
    const typeRaw = String(pick(row, "type_local", "typelocal") || "").trim().toLowerCase();
    if (!mutationId || !["maison", "appartement"].includes(typeRaw)) continue;
    const price = num(pick(row, "valeur_fonciere", "valeurfonciere"));
    const surface = num(pick(row, "surface_reelle_bati", "surfacereellebati"));
    const latitude = num(pick(row, "latitude"));
    const longitude = num(pick(row, "longitude"));
    const date = String(pick(row, "date_mutation", "datemutation") || "").slice(0, 10);
    if (!price || price < 10000 || price > 5000000 || !surface || surface < 9 || surface > 1000 ||
        latitude === null || longitude === null || latitude < 49 || latitude > 50.3 || longitude < 3.8 || longitude > 5.8 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const item = {
      mutationId, date, commune: String(pick(row, "nom_commune", "nomcommune") || "").trim(),
      postalCode: String(pick(row, "code_postal", "codepostal") || "").trim(),
      inseeCode: String(pick(row, "code_commune", "codecommune") || "").trim(),
      type: typeRaw === "maison" ? "Maison" : "Appartement",
      surface: Math.round(surface * 100) / 100,
      rooms: num(pick(row, "nombre_pieces_principales", "nombrepiecesprincipales")),
      terrain: num(pick(row, "surface_terrain", "surfaceterrain")),
      price: Math.round(price), latitude, longitude
    };
    if (!byMutation.has(mutationId)) byMutation.set(mutationId, []);
    byMutation.get(mutationId).push(item);
  }
  const result = [];
  for (const [mutationId, items] of byMutation) {
    // A mutation with multiple distinct residential units is not safely attributable
    // to a single property's price; exclude it instead of splitting price arbitrarily.
    const uniqueUnits = new Set(items.map(x => [x.type, x.surface, x.latitude.toFixed(5), x.longitude.toFixed(5)].join("|")));
    if (uniqueUnits.size !== 1) continue;
    const item = items[0];
    if (!item.commune) continue;
    result.push(item);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.mutationId.localeCompare(b.mutationId));
}
module.exports = { parseCsv, normalizeDvfRows, pick, num };