(() => {
  const $ = id => document.getElementById(id);
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }
  function params() {
    return new URLSearchParams({
      dept: $("dept")?.value.trim() || "08",
      ville: $("city")?.value.trim() || "Charleville-Mézières",
      radius_km: $("radius")?.value || "10",
      web_sources: $("sources")?.value || "9"
    });
  }
  function badge(type) {
    const map = {
      fort: "🔥 Prospection immédiate",
      reservoir: "🏦 Réservoir vendeur",
      marche_actif: "📈 Marché actif",
      a_surveiller: "👀 À surveiller",
      faible: "⚪ Faible priorité"
    };
    return map[type] || type || "À surveiller";
  }
  function money(v) {
    return Number(v) > 0 ? Number(v).toLocaleString("fr-FR") + " €" : "—";
  }
  function render(data) {
    const radar = data.sector_radar || {};
    const zones = radar.zones || [];
    const cells = radar.cells || [];
    const el = $("sectorRadar");
    if (!el) return;
    const topZones = zones.slice(0, 6);
    const topCells = cells.slice(0, 12);

    el.innerHTML =
      '<div class="sector-head"><div><h2>🧭 Radar des secteurs</h2>' +
      '<p>Le radar cherche les zones où activité du marché, signaux vendeurs et densité terrain se rencontrent. Aucun score unique ne remplace les indicateurs séparés.</p></div>' +
      '<span class="sector-version">Grille ' + Math.round((radar.cell_size_km || .5) * 1000) + ' m</span></div>' +
      '<div class="sector-warning">⚠️ Les annonces visibles ne mesurent pas la force réelle des agences. La rotation infra-cellulaire est volontairement non calculée tant que le parc de logements par cellule n’est pas disponible.</div>' +
      '<div class="sector-grid">' +
      topZones.map(z =>
        '<article class="sector-card"><div class="sector-card-top"><b>' + esc(z.id) + '</b><span>' + esc(z.recommendation_label) + '</span></div>' +
        '<div class="sector-metrics"><div><small>Activité</small><b>' + z.transactions_24m + ' tx</b></div>' +
        '<div><small>Signaux forts</small><b>' + z.candidates_strong + '</b></div>' +
        '<div><small>Densité</small><b>' + z.terrain_density + '/km²</b></div>' +
        '<div><small>Valeur ciblée</small><b>' + money(z.targeted_value) + '</b></div></div>' +
        '<div class="sector-meta">Potentiel statistique ' + z.potential_stat + '/100 · terrain ' + z.potential_terrain + '/100 · confiance ' + z.confidence + '%</div>' +
        '</article>'
      ).join("") +
      '</div>' +
      '<h3 class="sector-subtitle">Cellules à examiner</h3>' +
      '<div class="sector-table-wrap"><table class="sector-table"><thead><tr><th>Cellule</th><th>Activité</th><th>Vendeurs forts</th><th>Densité</th><th>Valeur ciblée</th><th>Confiance</th><th>Lecture</th></tr></thead><tbody>' +
      topCells.map(c =>
        '<tr><td><b>' + esc(c.key) + '</b></td><td>' + c.transactions_24m + '</td><td>' + c.candidates_strong + '</td><td>' + c.terrain_density + '</td><td>' + money(c.targeted_value) + '</td><td>' + c.confidence + '%</td><td>' + esc(c.recommendation_label) + '</td></tr>'
      ).join("") +
      '</tbody></table></div>' +
      '<div class="sector-footer">Méthode terrain : temps approximatif avec marge ±20 %. Les résultats servent à tester les zones de prospection ; ils ne constituent pas une prédiction de vente.</div>';
  }
  async function load() {
    const el = $("sectorRadar");
    if (!el) return;
    el.classList.add("loading");
    try {
      // Le Radar complet vient déjà de calculer sector_radar dans /api/marche.
      // On réutilise ce résultat pour éviter un second appel lourd DVF + DPE + Web.
      const cached = window.jmlSnapshot;
      if (cached?.sector_radar) {
        render(cached);
        return;
      }

      const res = await fetch("/api/secteurs?" + params(), { cache: "no-store" });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_) {
        throw new Error("Réponse serveur vide ou non JSON");
      }
      if (!res.ok) throw new Error(data.error || "Erreur Radar secteurs");
      // Si /api/marche a été interrompu mais que le calcul secteurs a abouti,
      // on récupère quand même les candidats cachés pour alimenter la tournée.
      if (data.hidden || data.current) {
        window.jmlSnapshot = {
          ...(window.jmlSnapshot || {}),
          hidden: data.hidden || window.jmlSnapshot?.hidden || [],
          current: data.current || window.jmlSnapshot?.current || [],
          sector_radar: data.sector_radar || window.jmlSnapshot?.sector_radar
        };
      }
      render(data);
    } catch (e) {
      el.innerHTML = '<div class="sector-error">Radar des secteurs indisponible : ' + esc(e.message) + '</div>';
    } finally {
      el.classList.remove("loading");
    }
  }
  function init() {
    if (!$("sectorRadar")) {
      const section = document.createElement("section");
      section.id = "sectorRadar";
      section.className = "panel sector-panel";
      $("stats")?.insertAdjacentElement("afterend", section);
    }
    $("market")?.addEventListener("click", () => setTimeout(load, 100));
  }
  document.addEventListener("DOMContentLoaded", init);
})();
