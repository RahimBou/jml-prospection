const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

test("every workspace navigation destination has a registered page", () => {
  const navPages = [...html.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]);
  const routeBlock = app.match(/const JML_PAGE_GROUPS=\{([\s\S]*?)\n\};/);
  assert.ok(routeBlock, "JML_PAGE_GROUPS must exist");
  const registered = [...routeBlock[1].matchAll(/^\s*([a-zA-Z]+):\[/gm)].map((m) => m[1]);
  for (const page of new Set(navPages)) {
    assert.ok(registered.includes(page), `Navigation page "${page}" is missing from JML_PAGE_GROUPS`);
  }
});

test("every panel referenced by the workspace router exists in the HTML", () => {
  const routeBlock = app.match(/const JML_PAGE_GROUPS=\{([\s\S]*?)\n\};/);
  assert.ok(routeBlock);
  const panelIds = [...routeBlock[1].matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)].map((m) => m[1]);
  for (const id of panelIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Router panel #${id} is missing from index.html`);
  }
});

test("navigation has one route entry point for CRM, tour and watch", () => {
  const start = app.indexOf("function showJmlPage(page)");
  const end = app.indexOf("// V1.61", start);
  assert.ok(start >= 0 && end > start);
  const route = app.slice(start, end);
  assert.match(route, /target==="crm"\)\{openCRM\(\);return;\}/);
  assert.match(route, /target==="tour"\)\{openTour\(\);return;\}/);
  assert.match(route, /target==="watch"\)\{openWatch\(\);return;\}/);
});

test("asset cache version matches the frontend version", () => {
  assert.match(app, /const APP_VERSION = "1\.75\.8";/);
  assert.match(html, /app\.js\?v=1\.75\.8/);
  assert.doesNotMatch(html, /\["a\[href="#futureRadarPanel"\]/);
});
