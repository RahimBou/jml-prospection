"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { parseCsv, normalizeDvfRows } = require("../engine/dvf-data");

const BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const INDEX_URL = BASE + "/2024/communes/08/";
const OUTPUT = path.resolve(process.env.DVF_OUTPUT || path.join(__dirname, "..", "data", "dvf-08.json"));

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { "User-Agent": "JML-Prospection-DVF/1.0", Accept: "text/csv,text/html,*/*" } });
  if (!response.ok) throw new Error("Source DVF HTTP " + response.status + " pour " + url);
  return response.text();
}
function extractCsvUrls(indexHtml, base = INDEX_URL) {
  const files = new Set();
  for (const match of String(indexHtml).matchAll(/href=["'](\d{5}\.csv)["']/gi)) files.add(new URL(match[1], base).href);
  return [...files].sort();
}
async function importDvf({ inputFile, outputFile = OUTPUT, fetchImpl = fetch, indexUrl = INDEX_URL } = {}) {
  let rows = [];
  let source;
  if (inputFile) {
    const local = path.resolve(inputFile);
    const text = await fs.readFile(local, "utf8");
    rows = parseCsv(text);
    source = "local:" + local;
  } else {
    const html = await fetchText(indexUrl, fetchImpl);
    const urls = extractCsvUrls(html, indexUrl);
    if (!urls.length) throw new Error("Aucun CSV communal trouvé dans l'index officiel DVF : " + indexUrl);
    source = indexUrl;
    // Sequential downloads keep load and memory predictable.
    for (const url of urls) {
      const text = await fetchText(url, fetchImpl);
      rows.push(...parseCsv(text));
    }
  }
  const normalized = normalizeDvfRows(rows);
  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify({
    schemaVersion: 1, department: "08", source, sourcePeriod: "2024",
    importedAt: new Date().toISOString(), rawRows: rows.length,
    acceptedSales: normalized.length, sales: normalized
  }, null, 2) + "\n", "utf8");
  return { source, rawRows: rows.length, acceptedSales: normalized.length, outputFile: path.resolve(outputFile) };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const inputFile = inputIndex >= 0 ? args[inputIndex + 1] : process.env.DVF_CSV;
  importDvf({ inputFile }).then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error("Import DVF échoué :", error.message);
    process.exitCode = 1;
  });
}
module.exports = { importDvf, extractCsvUrls, fetchText, INDEX_URL };