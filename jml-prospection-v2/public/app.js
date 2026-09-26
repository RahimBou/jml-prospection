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
  const ordered = [...items].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0) ||
    Number(b.score_breakdown?.dvf_history || 0) - Number(a.score_breakdown?.dvf_history || 0)
  );

  return ordered.map((item, index) => {
    const address = item.address || "";
    const level = priorityLevel(item.score);
    const checked = selectedAddresses.has(address) ? " checked" : "";
    return '<article class="card priority tour-card' + (checked ? ' selected-card' : '') + '">' +
      '<div class="select-row">' +
      '<label><input type="checkbox" data-select="' + escapeAttr(address) + '"' + checked +
      '> Sélectionner</label>' +
      '<span class="priority-badge priority-' + level + '">Priorité ' + level + '</span>' +
      '</div>' +
      '<div class="score">#' + (index + 1) + ' · ' + Number(item.score || 0) + '/100</div>' +
      '<h3>' + escapeHtml(address || "Adresse non précisée") + '</h3>' +
      '<div class="meta">' + escapeHtml(item.city || "") + ' · ' +
      (item.surface || "—") + ' m² · DPE <b>' + escapeHtml(item.dpe || "—") +
      '</b>' + (item.ges ? ' · GES ' + escapeHtml(item.ges) : '') +
      (item.construction_year ? ' · construction ' + escapeHtml(item.construction_year) : '') +
      '</div>' +
      '<div class="reasons"><b>Décomposition</b> ' + renderScoreBreakdown(item.score_breakdown) + '</div>' +
      '<div class="reasons">' + (item.reason || []).map(reason =>
        '<span class="tag">' + escapeHtml(reason) + '</span>'
      ).join(" ") + '</div>' +
      '<button class="field-btn" data-address="' + escapeAttr(address) +
      '">📍 Préparer la visite</button></article>';
  }).join("");
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

function renderScoreBreakdown(breakdown = {}) {
  const labels = [
    ["dpe", "DPE"],
    ["ges", "GES"],
    ["surface", "Surface"],
    ["age", "Âge du bien"],
    ["market_absence", "Absence annonce"],
    ["dvf_history", "Historique DVF"],
    ["data_quality", "Qualité données"]
  ];
  return labels
    .filter(([key]) => Number(breakdown[key] || 0) > 0)
    .map(([key, label]) =>
      '<span class="tag">' + escapeHtml(label) + ' +' + Number(breakdown[key]) + '</span>'
    ).join(" ");
}

let selectedAddresses = new Set();

function priorityLevel(score) {
  const s = Number(score || 0);
  return s >= 84 ? "A" : s >= 80 ? "B" : "C";
}

function updateSelectionCount() {
  $("selectionCount").textContent = selectedAddresses.size + "/10 sélectionné(s)";
}

function toggleSelection(address, checked) {
  if (checked && selectedAddresses.size >= 10) {
    const box = document.querySelector('input[data-select="' + CSS.escape(address) + '"]');
    if (box) box.checked = false;
    $("tourMessage").textContent = "Maximum 10 adresses par tournée.";
    return;
  }
  if (checked) selectedAddresses.add(address);
  else selectedAddresses.delete(address);
  document.querySelectorAll(".tour-card").forEach(card => {
    const input = card.querySelector("input[type=checkbox]");
    card.classList.toggle("selected-card", !!input?.checked);
  });
  updateSelectionCount();
  $("tourMessage").textContent = "";
}

function renderTop10(items = []) {
  const top = [...items].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0) ||
    Number(b.score_breakdown?.dvf_history || 0) - Number(a.score_breakdown?.dvf_history || 0)
  ).slice(0, 10);

  if (!top.length) {
    $("top10").innerHTML = '<div class="empty">Aucune adresse prioritaire détectée sur cette analyse.</div>';
    updateSelectionCount();
    return;
  }

  $("top10").innerHTML = top.map((item, index) => {
    const address = item.address || "";
    const level = priorityLevel(item.score);
    const checked = selectedAddresses.has(address) ? " checked" : "";

    return '<article class="card priority tour-card' + (checked ? ' selected-card' : '') + '">' +
      '<div class="select-row">' +
      '<label><input type="checkbox" data-select="' + escapeAttr(address) + '"' + checked +
      '> Sélectionner</label>' +
      '<span class="priority-badge priority-' + level + '">Priorité ' + level + '</span>' +
      '</div>' +
      '<div class="score">#' + (index + 1) + ' · ' + Number(item.score || 0) + '/100</div>' +
      '<h3>' + escapeHtml(address || "Adresse non précisée") + '</h3>' +
      '<div class="meta">' + escapeHtml(item.city || "") + ' · DPE ' +
      escapeHtml(item.dpe || "—") + ' · GES ' + escapeHtml(item.ges || "—") +
      ' · ' + (item.surface || "—") + ' m²' +
      (item.construction_year ? ' · construction ' + escapeHtml(item.construction_year) : '') +
      '</div>' +
      '<div class="reasons"><b>Décomposition du score</b> ' +
      renderScoreBreakdown(item.score_breakdown) + '</div>' +
      '<div class="reasons">' + (item.reason || []).map(reason =>
      '<span class="tag">' + escapeHtml(reason) + '</span>').join(" ") +
      '</div>' +
      '<button class="field-btn" data-address="' + escapeAttr(address) +
      '">📍 Préparer la visite</button>' +
      '</article>';
  }).join("");

  document.querySelectorAll("input[data-select]").forEach(input => {
    input.addEventListener("change", () =>
      toggleSelection(input.dataset.select, input.checked)
    );
  });

  updateSelectionCount();
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

  if (activeTab === "hidden") {
    const toolbar = '<div class="tour-toolbar terrain-toolbar">' +
      '<div><b>Prospection terrain</b><span>' + items.length + ' adresse(s) à qualifier · sélection max 10</span></div>' +
      '<div class="tour-actions">' +
      '<button id="selectTerrainTop">⚡ Sélectionner les 10 meilleures</button>' +
      '<button id="clearTerrain" class="secondary">✕ Effacer</button>' +
      '</div></div>';
    $("results").insertAdjacentHTML("afterbegin", toolbar);

    document.querySelectorAll("input[data-select]").forEach(input => {
      input.addEventListener("change", () => toggleSelection(input.dataset.select, input.checked));
    });

    $("selectTerrainTop").addEventListener("click", () => {
      selectedAddresses.clear();
      [...items].sort((a,b) =>
        Number(b.score||0)-Number(a.score||0) ||
        Number(b.score_breakdown?.dvf_history||0)-Number(a.score_breakdown?.dvf_history||0)
      ).slice(0,10).forEach(x => selectedAddresses.add(x.address));
      render();
      $("tourMessage").textContent = "Les 10 meilleures adresses terrain sont sélectionnées.";
    });

    $("clearTerrain").addEventListener("click", () => {
      selectedAddresses.clear();
      render();
      $("tourMessage").textContent = "";
    });
  }
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
    const sourceStatus = data.source_status || {};
    const statusParts = ["✓ Sources traitées"];
    if (sourceStatus.dvf_source === "data.gouv.fr" || data.market?.dvf_fallback) {
      statusParts.push("DVF officiel : data.gouv.fr");
    }
    if ((data.errors || []).length) {
      const ceremaOnly = (data.errors || []).every(x => /Cerema DVF indisponible/i.test(x));
      statusParts.push(ceremaOnly
        ? "Cerema indisponible — repli officiel actif"
        : "⚠ " + data.errors.join(" · "));
    }
    $("message").textContent = statusParts.join(" · ");
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

$("selectPriority").addEventListener("click", () => {
  selectedAddresses.clear();
  const top = [...(snapshot?.hidden || [])]
    .sort((a,b) => Number(b.score||0)-Number(a.score||0))
    .slice(0, 10);
  top.forEach(x => selectedAddresses.add(x.address));
  render();
  $("tourMessage").textContent = "Les 10 priorités du Radar sont sélectionnées.";
});

$("clearSelection").addEventListener("click", () => {
  selectedAddresses.clear();
  render();
  $("tourMessage").textContent = "";
});

$("prepareTour").addEventListener("click", async () => {
  const selected = [...(snapshot?.hidden || [])]
    .filter(x => selectedAddresses.has(x.address))
    .slice(0, 10);

  if (!selected.length) {
    $("tourMessage").textContent = "Sélectionne au moins une adresse.";
    return;
  }

  $("tourMessage").textContent = "Regroupement des adresses par secteurs et optimisation du parcours…";

  try {
    const enriched = [];
    for (const item of selected) {
      let lat = Number(item.lat), lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const geo = await getJSON("/api/geocode?q=" + encodeURIComponent(item.address));
        const first = geo.items?.[0];
        lat = Number(first?.lat);
        lon = Number(first?.lon);
      }
      if (Number.isFinite(lat) && Number.isFinite(lon)) enriched.push({...item, lat, lon});
    }

    if (!enriched.length) throw new Error("Aucune adresse n’a pu être géolocalisée.");

    // Regroupement en secteurs d'environ 700 m pour limiter les allers-retours.
    const CELL_KM = 0.7;
    const latStep = CELL_KM / 111;
    const lonStep = CELL_KM / 75;
    const sectorKey = x =>
      Math.floor(x.lat / latStep) + "/" + Math.floor(x.lon / lonStep);

    const sectors = new Map();
    enriched.forEach(x => {
      const key = sectorKey(x);
      if (!sectors.has(key)) sectors.set(key, []);
      sectors.get(key).push(x);
    });

    const distance2 = (a, b) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;

    const sectorList = [...sectors.values()].map((items, index) => ({
      id: index + 1,
      items,
      lat: items.reduce((s, x) => s + x.lat, 0) / items.length,
      lon: items.reduce((s, x) => s + x.lon, 0) / items.length
    }));

    // Ordre des secteurs par proximité, puis ordre des adresses à l'intérieur.
    const orderedSectors = [];
    const remainingSectors = [...sectorList];
    let currentSector = remainingSectors.shift();
    orderedSectors.push(currentSector);

    while (remainingSectors.length) {
      remainingSectors.sort((a, b) =>
        distance2(a, currentSector) - distance2(b, currentSector)
      );
      currentSector = remainingSectors.shift();
      orderedSectors.push(currentSector);
    }

    const ordered = [];
    let currentPoint = null;

    orderedSectors.forEach((sector, sectorIndex) => {
      const remaining = [...sector.items];
      const sectorOrdered = [];

      while (remaining.length) {
        if (currentPoint) {
          remaining.sort((a, b) => distance2(a, currentPoint) - distance2(b, currentPoint));
        }
        const next = remaining.shift();
        sectorOrdered.push(next);
        currentPoint = next;
      }

      sector.number = sectorIndex + 1;
      sector.orderedItems = sectorOrdered;
      ordered.push(...sectorOrdered);
    });

    const stops = ordered.map(x =>
      encodeURIComponent(x.address + ", " + (x.city || ""))
    );
    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1).join("|");
    const mapUrl =
      "https://www.google.com/maps/dir/?api=1&destination=" + destination +
      (waypoints ? "&waypoints=" + waypoints : "") +
      "&travelmode=driving";

    window.open(mapUrl, "_blank", "noopener");

    const sectorSummary = orderedSectors.map(sector =>
      '<b>Secteur ' + sector.number + '</b> (' + sector.items.length + ' adresse' +
      (sector.items.length > 1 ? 's' : '') + ') : ' +
      sector.orderedItems.map(x => escapeHtml(x.address)).join(" → ")
    ).join("<br>");

    $("tourMessage").innerHTML =
      '<div class="tour-summary"><b>🗺️ Tournée optimisée</b><br>' +
      ordered.length + ' adresse(s) · ' + orderedSectors.length + ' secteur(s)<br><br>' +
      sectorSummary + '</div>';
  } catch (e) {
    $("tourMessage").textContent = "Erreur tournée : " + e.message;
  }
});

getJSON("/api/health")
  .then(data => $("status").textContent = "V" + data.version)
  .catch(() => $("status").textContent = "Serveur indisponible");
