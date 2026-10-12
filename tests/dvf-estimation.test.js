"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, normalizeDvfRows } = require("../engine/dvf-data");
const { estimate } = require("../engine/comparables");
const { extractCsvUrls } = require("../scripts/import-dvf");

function sale(overrides = {}) {
  return { mutationId: "m1", date: "2025-03-01", commune: "Charleville-Mézières", postalCode: "08000",
    type: "Maison", surface: 100, rooms: 5, terrain: 400, price: 180000,
    latitude: 49.77, longitude: 4.72, ...overrides };
}
test("CSV parser handles quoted delimiters and semicolon format", () => {
  const rows = parseCsv('id_mutation;nom_commune;valeur_fonciere\n1;"Charleville-Mézières";"180000"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nom_commune, "Charleville-Mézières");
});
test("DVF normalization keeps a single valid home and excludes bad and multi-unit mutations", () => {
  const rows = [
    { ...sale(), id_mutation: "m1", type_local: "Maison", valeur_fonciere: "180000", surface_reelle_bati: "100", latitude: "49.77", longitude: "4.72", date_mutation: "2025-03-01", nom_commune: "Charleville-Mézières", code_postal: "08000", nombre_pieces_principales: "5", surface_terrain: "400" },
    { id_mutation: "m2", type_local: "Maison", valeur_fonciere: "150000", surface_reelle_bati: "100", latitude: "49.77", longitude: "2.00", date_mutation: "2025-03-01", nom_commune: "Sedan", code_postal: "08200" },
    { id_mutation: "m3", type_local: "Maison", valeur_fonciere: "180000", surface_reelle_bati: "100", latitude: "49.77", longitude: "4.72", date_mutation: "2025-03-01", nom_commune: "Sedan", code_postal: "08200" },
    { id_mutation: "m3", type_local: "Appartement", valeur_fonciere: "180000", surface_reelle_bati: "60", latitude: "49.77", longitude: "4.72", date_mutation: "2025-03-01", nom_commune: "Sedan", code_postal: "08200" }
  ];
  const out = normalizeDvfRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].mutationId, "m1");
});
test("extracts only CSV URLs from the official Etalab directory index", () => {
  const urls = extractCsvUrls('<a href="08001.csv">08001.csv</a><a href="../">parent</a><a href="08105.csv">08105.csv</a>');
  assert.deepEqual(urls, ["https://files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/08/08001.csv", "https://files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/08/08105.csv"]);
});
test("estimator weights similar nearby sales and returns range with comparables", () => {
  const rows = Array.from({ length: 12 }, (_, i) => sale({ mutationId: "m" + i, date: "2025-0" + (i % 9 + 1) + "-01", price: 175000 + i * 1000, latitude: 49.77 + i * 0.001, longitude: 4.72, surface: 98 + i }));
  const result = estimate({ type: "Maison", surface: 100, terrain: 400, rooms: 5, latitude: 49.77, longitude: 4.72, dateReference: "2026-01-01" }, rows);
  assert.ok(result.value > 100000 && result.value < 300000);
  assert.ok(result.low <= result.value && result.high >= result.value);
  assert.equal(result.comparables.length, 5);
});
test("estimator reports low reliability when comparable count is insufficient", () => {
  const result = estimate({ type: "Maison", surface: 100, latitude: 49.77, longitude: 4.72, dateReference: "2026-01-01" }, [sale()]);
  assert.equal(result.reliability, "faible");
  assert.equal(result.comparableCount, 1);
});
test("rejects invalid API estimation inputs", () => {
  assert.throws(() => estimate({ type: "Terrain", surface: 100, latitude: 49.77, longitude: 4.72 }, [sale()]), /type/);
  assert.throws(() => estimate({ type: "Maison", surface: 2, latitude: 49.77, longitude: 4.72 }, [sale()]), /surface/);
});
