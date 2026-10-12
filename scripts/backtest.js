"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { estimate } = require("../engine/comparables");

function median(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function summarize(rows) {
  const errors = rows.map(r => r.errorPct);
  return {
    n: rows.length,
    medianAbsoluteErrorPct: median(errors),
    within10Pct: rows.length ? rows.filter(r => r.errorPct <= 10).length / rows.length : null,
    within20Pct: rows.length ? rows.filter(r => r.errorPct <= 20).length / rows.length : null,
    intervalCoverage: rows.length ? rows.filter(r => r.actual >= r.low && r.actual <= r.high).length / rows.length : null
  };
}
function runBacktest(sales, { months = 6, today = new Date() } = {}) {
  const cutoff = new Date(today);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const recent = sales.filter(s => new Date(s.date) >= cutoff && new Date(s.date) <= today);
  const results = [];
  for (const actual of recent) {
    const history = sales.filter(s => new Date(s.date) < new Date(actual.date));
    if (history.length < 5) continue;
    let prediction;
    try {
      prediction = estimate({
        type: actual.type, surface: actual.surface, terrain: actual.terrain, rooms: actual.rooms,
        latitude: actual.latitude, longitude: actual.longitude, commune: actual.commune, dateReference: actual.date
      }, history, { referenceDate: actual.date });
    } catch { continue; }
    if (!prediction.value || !Number.isFinite(actual.price)) continue;
    results.push({
      commune: actual.commune || "Commune inconnue", type: actual.type,
      actual: actual.price, predicted: prediction.value,
      errorPct: Math.abs(prediction.value - actual.price) / actual.price * 100,
      low: prediction.low, high: prediction.high, reliability: prediction.reliability
    });
  }
  const groups = {};
  for (const row of results) {
    const key = row.commune + " | " + row.type;
    (groups[key] ||= []).push(row);
  }
  return { tested: results.length, overall: summarize(results), groups: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, summarize(rows)])), results };
}
async function main() {
  const file = path.resolve(process.env.DVF_DATA || path.join(__dirname, "..", "data", "dvf-08.json"));
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  const report = runBacktest(data.sales || []);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { runBacktest, summarize };