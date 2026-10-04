/* JML Prospection Workflow
 * Radar -> Top 10 -> Fiche -> Argumentaire -> Suivi
 * IMPORTANT: ce module consomme le Radar existant via JMLFutureRadarBridge.
 */
(() => {
  "use strict";

  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[c]));

  const root = () => document.getElementById("prospectionWorkflow");

  const crmRows = () => {
    try {
      return JSON.parse(localStorage.getItem("jml_prospection_v1") || "[]");
    } catch (_) {
      return [];
    }
  };

  const radarRows = () => {
    try {
      const bridge = window.JMLFutureRadarBridge;
      if (bridge && typeof bridge.getCandidates === "function") {
        const rows = bridge.getCandidates();
        return Array.isArray(rows) ? rows : [];
      }
    } catch (_) {}
    return [];
  };

  const score = (p) => Number(
    p?.priorityProspectionScore ??
    p?.priorityScore ??
    p?.futureRadarScore ??
    p?.commercialSignalScore ??
    0
  );

  const label = (p) => [
    p?.address || "Adresse à compléter",
    p?.postalCode,
    p?.city
  ].filter(Boolean).join(" · ");

  const top10 = () => {
    const rows = radarRows();
    if (!rows.length) return [];
    /* Le Radar a déjà calculé et trié ses priorités : on conserve son ordre. */
    return rows.slice(0, 10);
  };

  const findCrm = (id) =>
    crmRows().find((p) => String(p?.id) === String(id)) || null;

  const findProspect = (id) => {
    const rows = top10();
    return rows.find((p) => String(p?.id) === String(id)) || findCrm(id);
  };

  function detailHtml(p) {
    if (!p) {
      return `
        <div class="flow-empty big">
          Aucun dossier sélectionné.<br>
          <button type="button" class="primary" data-flow-radar>🎯 Ouvrir le Radar</button>
        </div>`;
    }

    const reasons = Array.isArray(p.priorityProspectionReasons)
      ? p.priorityProspectionReasons.slice(0, 4)
      : Array.isArray(p.reasons) ? p.reasons.slice(0, 4) : [];

    const dpe = p.dpe || "—";
    const sale = p.sameAddressSale || {};
    const comparables = Number(p.comparableCount ?? (Array.isArray(p.comparables) ? p.comparables.length : 0));
    const price = Number(p.price);

    return `
      <div class="flow-detail-head">
        <div>
          <span class="flow-kicker">FICHE PRIORITAIRE</span>
          <h3>${esc(label(p))}</h3>
          <p>${esc([
            p.type || p.buildingType || "Bien",
            p.area ? p.area + " m²" : "",
            p.rooms ? p.rooms + " pièces" : ""
          ].filter(Boolean).join(" · "))}</p>
        </div>
        <div class="flow-big-score">
          ${score(p).toFixed(1)}<small>/100</small>
          <em>${esc(p.priorityProspectionLevel || (score(p) >= 65 ? "Priorité" : "À travailler"))}</em>
        </div>
      </div>

      <div class="flow-metrics">
        <div><span>DPE</span><strong>${esc(dpe)}</strong></div>
        <div><span>DVF même adresse</span><strong>${esc(sale.status === "confirmed" ? "Confirmée" : "À vérifier")}</strong></div>
        <div><span>Comparables</span><strong>${comparables}</strong></div>
        <div><span>Prix</span><strong>${Number.isFinite(price) && price > 0 ? price.toLocaleString("fr-FR") + " €" : "—"}</strong></div>
      </div>

      <div class="flow-reasons">
        <h4>Pourquoi ce dossier est dans le Top 10</h4>
        ${reasons.length
          ? reasons.map((x) => `<span>✓ ${esc(x)}</span>`).join("")
          : "<span>Classement issu des scores déjà calculés par le Radar JML.</span>"}
      </div>

      <div class="flow-actions">
        <button type="button" class="primary" data-flow-fiche="${esc(p.id)}">📋 Ouvrir la fiche</button>
        <button type="button" class="ghost" data-flow-argument="${esc(p.id)}">💬 Argumentaire vendeur</button>
        <button type="button" class="ghost" data-flow-call="${esc(p.id)}">📞 Préparer l'appel</button>
      </div>

      <div class="flow-follow">
        <div>
          <h4>Suivi commercial</h4>
          <p>Le suivi reste manuel : aucune intention de vente n'est déduite automatiquement.</p>
        </div>
        <div class="flow-follow-actions">
          <select data-flow-status>
            <option value="">Changer le statut…</option>
            <option>À contacter</option>
            <option>Visité</option>
            <option>À relancer</option>
            <option>Mandat obtenu</option>
            <option>Mandat refusé</option>
            <option>Vendu / abandonné</option>
          </select>
          <input type="date" data-flow-follow-date value="${esc(p.nextFollow || "")}">
          <button type="button" class="ghost" data-flow-save>💾 Enregistrer le suivi</button>
        </div>
      </div>

      <div id="flowArgument" class="flow-argument"></div>`;
  }

  function render() {
    const el = root();
    if (!el) return;

    const rows = top10();
    const selectedId = el.dataset.selected || rows[0]?.id || "";
    const selected = rows.find((p) => String(p?.id) === String(selectedId)) || rows[0] || null;

    el.innerHTML = `
      <div class="flow-head">
        <div>
          <span class="flow-kicker">POSTE DE TRAVAIL VENDEUR</span>
          <h2>🎯 De la détection au mandat</h2>
          <p>Une seule chaîne : Radar → 10 priorités → fiche → argumentaire → suivi.</p>
        </div>
        <button type="button" id="flowRefresh" class="ghost">↻ Actualiser</button>
      </div>

      <div class="flow-steps">
        <div class="flow-step active"><b>1</b><strong>RADAR</strong><span>Détection</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-step active"><b>2</b><strong>TOP 10</strong><span>Priorisation</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-step active"><b>3</b><strong>FICHE</strong><span>Préparation</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-step active"><b>4</b><strong>ARGUMENTAIRE</strong><span>Pourquoi agir</span></div>
        <div class="flow-arrow">→</div>
        <div class="flow-step active"><b>5</b><strong>SUIVI</strong><span>Relance</span></div>
      </div>

      <div class="flow-grid">
        <aside>
          <div class="flow-list-head"><strong>Mes 10 priorités</strong><span>${rows.length}/10</span></div>
          ${rows.length
            ? rows.map((p, i) => `
              <button type="button" class="flow-prospect ${String(p?.id) === String(selected?.id) ? "selected" : ""}" data-flow-id="${esc(p?.id)}">
                <span class="flow-rank">#${i + 1}</span>
                <span class="flow-prospect-main">
                  <strong>${esc(label(p))}</strong>
                  <small>${esc(p.type || p.buildingType || "Bien")} · ${p.area ? Number(p.area).toLocaleString("fr-FR") + " m²" : "surface —"}</small>
                </span>
                <span class="flow-score">${score(p).toFixed(1)}</span>
              </button>`).join("")
            : '<div class="flow-empty">Lance le Radar pour constituer les 10 dossiers prioritaires.</div>'}
        </aside>

        <section class="flow-detail">${detailHtml(selected)}</section>
      </div>`;

    bind();
  }

  async function aiArgument(p, task) {
    const box = document.getElementById("flowArgument");
    if (!box || !p) return;

    box.innerHTML = '<div class="flow-loading">🧠 Préparation de l’argumentaire…</div>';

    try {
      const context =
        "Prépare un argumentaire COMMERCIAL pour un agent commercial immobilier JML. " +
        "Explique pourquoi le bien mérite une discussion sur sa valeur et sa stratégie de vente, " +
        "uniquement à partir des données fournies. Ne prétends jamais connaître l'intention du propriétaire. " +
        "Ne donne pas de données personnelles. Sois court, concret et utilisable à l'oral.";

      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({task: task || "why", prospect: p, context})
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "IA indisponible");
      }

      const text = data.text || data.local?.summary || "Aucun argumentaire généré.";
      box.innerHTML =
        '<div class="flow-argument-head"><strong>💬 Argumentaire vendeur</strong><span>' +
        esc(data.provider || "IA JML") +
        '</span></div><div>' + esc(text).replace(/\n/g, "<br>") + "</div>";
    } catch (_) {
      const reasons = Array.isArray(p.priorityProspectionReasons)
        ? p.priorityProspectionReasons.slice(0, 3) : [];

      box.innerHTML =
        '<div class="flow-argument-head"><strong>💬 Argumentaire local</strong><span>Sans appel externe</span></div>' +
        '<p>« Je peux vous expliquer la valeur de votre bien à partir de ventes réelles comparables et des caractéristiques de votre secteur. L’objectif est de distinguer le prix affiché, la valeur de marché et la stratégie de mise en vente. »</p>' +
        (reasons.length ? "<ul>" + reasons.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "");
    }
  }

  function bind() {
    const el = root();
    if (!el) return;

    el.querySelectorAll("[data-flow-id]").forEach((button) => {
      button.onclick = () => {
        el.dataset.selected = button.dataset.flowId;
        render();
      };
    });

    el.querySelector("#flowRefresh")?.addEventListener("click", render);

    const fiche = el.querySelector("[data-flow-fiche]");
    if (fiche) {
      fiche.onclick = () => {
        const p = findProspect(fiche.dataset.flowFiche);
        if (p && typeof window.openForm === "function") window.openForm(p);
      };
    }

    const arg = el.querySelector("[data-flow-argument]");
    if (arg) arg.onclick = () => aiArgument(findProspect(arg.dataset.flowArgument), "why");

    const call = el.querySelector("[data-flow-call]");
    if (call) call.onclick = () => aiArgument(findProspect(call.dataset.flowCall), "call");

    const radar = el.querySelector("[data-flow-radar]");
    if (radar) radar.onclick = () =>
      document.getElementById("futureRadarPanel")?.scrollIntoView({behavior: "smooth"});

    const save = el.querySelector("[data-flow-save]");
    if (save) {
      save.onclick = () => {
        const id = el.dataset.selected;
        const rows = crmRows();
        const p = rows.find((x) => String(x?.id) === String(id));
        if (!p) return;

        const status = el.querySelector("[data-flow-status]")?.value || "";
        const nextFollow = el.querySelector("[data-flow-follow-date]")?.value || "";

        if (status) p.status = status;
        if (nextFollow) p.nextFollow = nextFollow;
        p.updatedAt = new Date().toISOString();
        p.history = Array.isArray(p.history) ? p.history : [];
        p.history.push({
          date: p.updatedAt,
          type: status || "Suivi",
          text: status
            ? "Statut : " + status + (nextFollow ? " · Relance : " + nextFollow : "")
            : (nextFollow ? "Relance planifiée : " + nextFollow : "Mise à jour du suivi")
        });

        try {
          localStorage.setItem("jml_prospection_v1", JSON.stringify(rows));
        } catch (_) {}

        render();
        if (typeof window.render === "function") window.render();
      };
    }
  }

  window.JMLProspectionWorkflow = {render, top10};

  window.addEventListener("load", () => setTimeout(render, 50));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
})();
