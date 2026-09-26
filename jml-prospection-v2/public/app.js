const $ = id => document.getElementById(id);
let snapshot = null;
let activeTab = "current";

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur HTTP " + res.status);
  return data;
}

function params() {
  return new URLSearchParams({
    dept: $("dept").value.trim(),
    ville: $("city").value.trim(),
    radius_km: $("radius").value,
    web_sources: $("sources").value
  });
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function escapeAttr(v) {
  return escapeHtml(v);
}

function renderStats(counts = {}, market = {}) {
  $("stats").innerHTML = [
    ["Annonces en ligne", counts.current_listings || 0],
    ["À vérifier terrain", counts.hidden_opportunities || 0],
    ["Disparues", counts.disappeared || 0],
    ["Prix modifiés", counts.price_changes || 0],
    ["Transactions DVF", market.transactions || 0],
    ["Prix médian DVF/m²", market.median_price_m2 ? Number(market.median_price_m2).toLocaleString("fr-FR") + " €" : "—"]
  ].map(([label, value]) =>
    '<div class="stat"><span>' + label + '</span><b>' + value + '</b></div>'
  ).join("");
}

function renderCurrent(items = []) {
  return items.map(item => {
    const price = Number(item.price) > 0 ? Number(item.price).toLocaleString("fr-FR") + " €" : "Prix non détecté";
    const surface = Number(item.surface) > 0 ? Number(item.surface).toLocaleString("fr-FR") + " m²" : "Surface non détectée";
    const link = item.external_url
      ? '<p><a target="_blank" rel="noopener" href="' + escapeAttr(item.external_url) + '">Voir la fiche publique</a></p>'
      : "";
    return '<article class="card"><h3>' + escapeHtml(item.title || "Bien immobilier") +
      '</h3><div class="meta"><b>' + price + '</b> · ' + surface +
      '</div><div class="meta">' + escapeHtml(item.city || "") + " · " +
      escapeHtml(item.agency || item.source || "") + '</div><span class="tag">' +
      escapeHtml(item.property_type || "immobilier") + '</span>' + link + '</article>';
  }).join("");
}

function renderHidden(items = []) {
  return items.map(item =>
    '<article class="card priority"><div class="score">' + Number(item.score || 0) +
    '/100</div><h3>' + escapeHtml(item.address || "Adresse non précisée") +
    '</h3><div class="meta">' + escapeHtml(item.city || "") + ' · ' +
    (item.surface || "—") + ' m² · DPE <b>' + escapeHtml(item.dpe || "—") +
    '</b></div><div class="reasons">' + (item.reason || []).map(reason =>
      '<span class="tag">' + escapeHtml(reason) + '</span>'
    ).join(" ") + '</div><button class="field-btn" data-address="' +
    escapeAttr(item.address || "") + '">📍 Préparer cette adresse</button></article>'
  ).join("");
}

function renderDisappeared(items = []) {
  return items.map(item =>
    '<article class="card"><h3>' + escapeHtml(item.title || item.address || "Annonce") +
    '</h3><div class="meta">' + escapeHtml(item.city || "") +
    ' · dernière présence ' + escapeHtml(item.lastSeenAt || "") +
    '</div><span class="tag">Statut à vérifier — pas une preuve de vente</span></article>'
  ).join("");
}

function renderPrice(items = []) {
  return items.map(item =>
    '<article class="card"><h3>' + escapeHtml(item.title || "Bien") +
    '</h3><div class="meta">' + Number(item.previous_price || 0).toLocaleString("fr-FR") +
    ' € → ' + Number(item.current_price || item.price || 0).toLocaleString("fr-FR") +
    ' €</div><span class="tag">' + (Number(item.change || item.price_change || 0) > 0 ? "Hausse" : "Baisse") +
    '</span></article>'
  ).join("");
}

function renderTop10(items = []) {
  const top = [...items].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 10);
  if (!top.length) {
    $("top10").innerHTML = '<div class="empty">Aucune adresse prioritaire détectée sur cette analyse.</div>';
    return;
  }
  $("top10").innerHTML = top.map((item, index) =>
    '<article class="card priority"><div class="score">#' + (index + 1) + ' · ' +
    Number(item.score || 0) + '/100</div><h3>' + escapeHtml(item.address || "Adresse non précisée") +
    '</h3><div class="meta">' + escapeHtml(item.city || "") + ' · DPE ' +
    escapeHtml(item.dpe || "—") + ' · ' + (item.surface || "—") + ' m²</div>' +
    '<div class="reasons">' + (item.reason || []).map(reason =>
    '<span class="tag">' + escapeHtml(reason) + '</span>').join(" ") +
    '</div><button class="field-btn" data-address="' + escapeAttr(item.address || "") +
    '">📍 Préparer la visite</button></article>'
  ).join("");
}

function render() {
  const data = snapshot || {};
  const current = data.current || [];
  const hidden = data.hidden || [];
  renderTop10(hidden);

  let items = [];
  let title = "";
  if (activeTab === "current") { items = current; title = "🎯 Annonces en ligne"; }
  if (activeTab === "hidden") { items = hidden; title = "🟠 Adresses à vérifier sur le terrain"; }
  if (activeTab === "disappeared") { items = data.disappeared || []; title = "🟡 Annonces disparues — statut à vérifier"; }
  if (activeTab === "price") { items = data.price_changes || []; title = "🔵 Évolutions de prix"; }

  $("sectionTitle").textContent = title;
  $("count").textContent = items.length + " résultat(s)";
  $("results").innerHTML = items.length
    ? (activeTab === "current" ? renderCurrent(items)
      : activeTab === "hidden" ? renderHidden(items)
      : activeTab === "disappeared" ? renderDisappeared(items)
      : renderPrice(items))
    : '<div class="empty">Aucun résultat dans cette catégorie.</div>';
}

async function search() {
  $("status").textContent = "Recherche…";
  $("message").textContent = "";
  try {
    const data = await getJSON("/api/annonces?" + params());
    snapshot = {
      current: data.items || [],
      hidden: [],
      disappeared: [],
      price_changes: [],
      counts: {
        current_listings: data.total || 0,
        hidden_opportunities: 0,
        disappeared: 0,
        price_changes: 0
      },
      market: {}
    };
    renderStats(snapshot.counts);
    render();
    $("status").textContent = (data.total || 0) + " annonce(s)";
  } catch (e) {
    $("status").textContent = "Erreur";
    $("message").textContent = e.message;
  }
}

async function market() {
  $("status").textContent = "Radar en cours…";
  $("message").textContent = "Croisement Web public + DVF + DPE…";
  try {
    const data = await getJSON("/api/marche?" + params());
    snapshot = data;
    renderStats(data.counts || {}, data.market || {});
    render();
    $("status").textContent = "Radar terminé";
    $("message").textContent = (data.errors || []).length
      ? "⚠ " + data.errors.join(" · ")
      : "✓ Sources traitées";
  } catch (e) {
    $("status").textContent = "Erreur";
    $("message").textContent = e.message;
  }
}

async function health() {
  try {
    const data = await getJSON("/api/sources");
    $("status").textContent = "Sources";
    $("message").textContent = data.sources.map(x => x.label + " : " + x.status).join(" · ");
  } catch (e) {
    $("status").textContent = "Erreur";
    $("message").textContent = e.message;
  }
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    button.classList.add("active");
    activeTab = button.dataset.tab;
    render();
  });
});

document.addEventListener("click", event => {
  const button = event.target.closest(".field-btn");
  if (!button) return;
  const address = button.dataset.address || "";
  if (!address) return;
  window.open("/api/geocode?q=" + encodeURIComponent(address), "_blank", "noopener");
});

$("search").addEventListener("click", search);
$("market").addEventListener("click", market);
$("health").addEventListener("click", health);

getJSON("/api/health")
  .then(data => $("status").textContent = "V" + data.version)
  .catch(() => $("status").textContent = "Serveur indisponible");
