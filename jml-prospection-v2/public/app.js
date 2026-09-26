const $ = id => document.getElementById(id);

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

function renderStats(counts = {}) {
  $("stats").innerHTML = [
    ["Annonces en ligne", counts.current_listings || 0],
    ["Futurs vendeurs", counts.hidden_opportunities || 0],
    ["Annonces disparues", counts.disappeared || 0],
    ["Baisses de prix", counts.price_changes || 0]
  ].map(([label, value]) => '<div class="stat"><span>'+label+'</span><b>'+value+'</b></div>').join("");
}

function renderItems(items = []) {
  $("count").textContent = items.length + " résultat(s)";
  if (!items.length) {
    $("results").innerHTML = '<div class="empty">Aucun bien exploitable trouvé par les sources actuelles.</div>';
    return;
  }
  $("results").innerHTML = items.map(item => {
    const price = Number(item.price) > 0 ? Number(item.price).toLocaleString("fr-FR") + " €" : "Prix non détecté";
    const surface = Number(item.surface) > 0 ? Number(item.surface).toLocaleString("fr-FR") + " m²" : "Surface non détectée";
    return '<article class="card">' +
      '<h3>'+escapeHtml(item.title || "Bien immobilier")+'</h3>' +
      '<div class="meta"><b>'+price+'</b> · '+surface+' · '+escapeHtml(item.agency || item.source || "")+'</div>' +
      '<div class="meta">'+escapeHtml(item.city || "")+'</div>' +
      '<span class="tag">'+escapeHtml(item.property_type || "immobilier")+'</span>' +
      (item.external_url ? '<p><a target="_blank" rel="noopener" href="'+escapeAttr(item.external_url)+'">Voir la fiche publique</a></p>' : '') +
      '</article>';
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function escapeAttr(value) { return escapeHtml(value); }

async function search() {
  $("status").textContent = "Recherche…";
  try {
    const data = await getJSON("/api/annonces?" + params());
    renderItems(data.items);
    $("status").textContent = data.total + " annonce(s)";
  } catch (e) {
    $("status").textContent = "Erreur";
    $("results").innerHTML = '<div class="empty">'+escapeHtml(e.message)+'</div>';
  }
}

async function market() {
  $("status").textContent = "Analyse…";
  try {
    const data = await getJSON("/api/marche?" + params());
    renderStats(data.counts);
    renderItems(data.items);
    $("status").textContent = "Analyse terminée";
  } catch (e) {
    $("status").textContent = "Erreur";
  }
}

async function health() {
  $("status").textContent = "Contrôle…";
  try {
    const data = await getJSON("/api/sources");
    $("status").textContent = data.sources.filter(x => x.status === "available").length + " source(s) disponibles";
    $("results").innerHTML = data.sources.map(x => '<article class="card"><h3>'+escapeHtml(x.label)+'</h3><div class="meta">'+escapeHtml(x.status)+'</div></article>').join("");
  } catch (e) {
    $("status").textContent = "Erreur";
  }
}

$("search").addEventListener("click", search);
$("market").addEventListener("click", market);
$("health").addEventListener("click", health);

getJSON("/api/health").then(data => {
  $("status").textContent = "V" + data.version;
}).catch(() => {
  $("status").textContent = "Serveur indisponible";
});
