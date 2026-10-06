#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CSV = path.join(ROOT, "benchmarks", "leads-casaran-2026-10.csv");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const baseUrl = arg("--base-url", process.env.JML_BASE_URL || "http://localhost:10000").replace(/\/+$/, "");
const csvPath = path.resolve(arg("--csv", DEFAULT_CSV));
const outPath = arg("--out", "");

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') { cell += '"'; i++; }
      else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(cell); cell = "";
    } else if ((c === "\n" || c === "\r") && !quote) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some(x => x !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function encode(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== "") q.set(k, String(v));
  }
  return q.toString();
}

async function getJson(pathname, params = {}) {
  const url = baseUrl + pathname + "?" + encode(params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "JML-Benchmark/1.0" },
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!response.ok) throw new Error("HTTP " + response.status + (data?.error ? " — " + data.error : ""));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizedType(type) {
  if (/studio|appartement/i.test(type)) return "Appartement";
  if (/maison/i.test(type)) return "Maison";
  return type;
}

function hasAddressHint(location) {
  return /\b\d{1,4}\b|\b(rue|avenue|av\.|boulevard|bd\.|chemin|impasse|place|route|faubourg|quai)\b/i.test(location);
}

function classifyGap(gap) {
  if (!Number.isFinite(gap)) return "";
  const a = Math.abs(gap);
  if (a <= 0.05) return "≤5%";
  if (a <= 0.10) return "≤10%";
  if (a <= 0.15) return "≤15%";
  if (a <= 0.20) return "≤20%";
  return ">20%";
}

async function run() {
  if (!fs.existsSync(csvPath)) throw new Error("CSV introuvable: " + csvPath);
  const leads = parseCsv(fs.readFileSync(csvPath, "utf8"));
  if (!leads.length) throw new Error("CSV vide");
  if (leads.length !== 200) console.warn("Attention: le CSV contient " + leads.length + " lignes, 200 étaient attendues.");

  const results = [];
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const result = {
      id: Number(lead.id), date: lead.date, type: lead.type, source: lead.source,
      location: lead.location, status: lead.status,
      askingPriceEur: number(lead.asking_price_eur), surfaceM2: number(lead.surface_m2),
      askingPriceM2: number(lead.asking_price_m2), locationKind: lead.location_kind,
      geocodeStatus: "not_tested", addressTestStatus: "not_applicable",
      dvfStatus: "not_tested", dpeStatus: "not_tested", comparableCount: 0,
      comparableMedianPriceM2: null, marketBenchmarkEur: null,
      gapVsAskingPct: null, gapBand: "", error: ""
    };

    try {
      const geo = await getJson("/api/geocode", { q: lead.location });
      const geos = Array.isArray(geo?.results) ? geo.results : [];
      result.geocodeStatus = geos.length ? "resolved" : "not_resolved";

      if (!hasAddressHint(lead.location)) {
        result.addressTestStatus = "not_testable_from_source";
        results.push(result);
        continue;
      }

      result.addressTestStatus = "tested";
      const match = await getJson("/api/prospect-match", {
        address: lead.location, city: "", postalCode: "",
        type: normalizedType(lead.type), area: number(lead.surface_m2),
        price: number(lead.asking_price_eur)
      });

      result.dvfStatus = match?.dvf?.status || "none";
      result.dpeStatus = match?.dpe?.status || "none";
      result.comparableCount = number(match?.comparables?.count);
      result.comparableMedianPriceM2 = Number.isFinite(Number(match?.comparables?.medianPriceM2))
        ? Number(match.comparables.medianPriceM2) : null;

      if (result.comparableMedianPriceM2 > 0 && result.surfaceM2 > 0) {
        result.marketBenchmarkEur = Math.round(result.comparableMedianPriceM2 * result.surfaceM2);
        if (result.askingPriceEur > 0) {
          result.gapVsAskingPct = (result.marketBenchmarkEur - result.askingPriceEur) / result.askingPriceEur;
          result.gapBand = classifyGap(result.gapVsAskingPct);
        }
      }
    } catch (error) {
      result.error = error?.message || String(error);
    }

    results.push(result);
    process.stdout.write("\r" + (i + 1) + "/" + leads.length);
  }
  process.stdout.write("\n");

  const exactRows = results.filter(x => x.addressTestStatus === "tested");
  const geocoded = results.filter(x => x.geocodeStatus === "resolved");
  const comparableRows = results.filter(x => x.comparableMedianPriceM2 > 0 && x.askingPriceEur > 0);
  const dvfExact = results.filter(x => x.dvfStatus === "exact");
  const dvfStreet = results.filter(x => x.dvfStatus === "street");
  const dpeConfirmed = results.filter(x => x.dpeStatus === "confirmed");
  const bands = ["≤5%", "≤10%", "≤15%", "≤20%", ">20%"];
  const bandCounts = Object.fromEntries(bands.map(b => [b, comparableRows.filter(x => x.gapBand === b).length]));

  const summary = {
    benchmark: "JML Prospection — leads Casaran 2026-10", baseUrl,
    observations: results.length,
    sourceBreakdown: Object.fromEntries([...new Set(results.map(x => x.source))].map(s => [s, results.filter(x => x.source === s).length])),
    locationKindBreakdown: Object.fromEntries([...new Set(results.map(x => x.locationKind))].map(s => [s, results.filter(x => x.locationKind === s).length])),
    geocodeResolved: geocoded.length, geocodeRate: results.length ? geocoded.length / results.length : 0,
    exactAddressRowsTested: exactRows.length,
    addressRowsNotTestableFromSource: results.filter(x => x.addressTestStatus === "not_testable_from_source").length,
    dvfExact: dvfExact.length, dvfStreet: dvfStreet.length, dpeConfirmed: dpeConfirmed.length,
    comparableRows: comparableRows.length, askingVsMarketBenchmarkBands: bandCounts,
    note: "Le prix affiché est un prix demandé. Le benchmark de précision réel doit utiliser une vente DVF du même bien lorsque celle-ci peut être identifiée avec un niveau de confiance suffisant."
  };

  const report = { summary, results };
  console.log(JSON.stringify(summary, null, 2));
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log("Rapport écrit:", path.resolve(outPath));
  }
}

run().catch(error => {
  console.error("\nBenchmark arrêté:", error.message || error);
  process.exitCode = 1;
});
