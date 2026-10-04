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
    const opportunity = Number(p.sellerOpportunityScore ?? p.marketContextScore ?? 0);
    const signal = Number(p.commercialSignalScore ?? 0);
    const quality = Number(p.dataQuality?.score ?? p.evidence?.dataQuality?.score ?? 0);
    const terrain = Number(p.terrainArea ?? p.landArea ?? p.land ?? 0);
    const price = Number(p.price);
    const priceM2 = Number(p.priceM2 ?? (price > 0 && Number(p.area) > 0 ? price / Number(p.area) : 0));
    const medianM2 = Number(p.medianPriceM2 ?? p.marketMedianPriceM2 ?? 0);
    const centralValue = Number(p.estimatedValue ?? p.valueCentral ?? p.marketValue ?? 0);
    const lowValue = Number(p.priceRangeLow ?? p.estimatedLow ?? p.rangeLow ?? 0);
    const highValue = Number(p.priceRangeHigh ?? p.estimatedHigh ?? p.rangeHigh ?? 0);

    const marketHtml = (medianM2 || centralValue || lowValue || highValue)
      ? `
        <div class="flow-section">
          <div class="flow-section-head"><div><span class="flow-kicker">REPÈRE MARCHÉ</span><h4>💶 Ce que les données permettent de dire</h4></div><span class="flow-section-note">Données disponibles dans le dossier</span></div>
          <div class="flow-market-grid">
            ${medianM2 ? `<div><span>Médiane DVF</span><strong>${Math.round(medianM2).toLocaleString("fr-FR")} €/m²</strong></div>` : ""}
            ${priceM2 ? `<div><span>Prix du bien</span><strong>${Math.round(priceM2).toLocaleString("fr-FR")} €/m²</strong></div>` : ""}
            ${centralValue ? `<div><span>Valeur centrale</span><strong>${Math.round(centralValue).toLocaleString("fr-FR")} €</strong></div>` : ""}
            ${lowValue || highValue ? `<div><span>Fourchette indicative</span><strong>${lowValue ? Math.round(lowValue).toLocaleString("fr-FR") : "—"} → ${highValue ? Math.round(highValue).toLocaleString("fr-FR") : "—"} €</strong></div>` : ""}
          </div>
        </div>`
      : `
        <div class="flow-section flow-section-muted">
          <div class="flow-section-head"><div><span class="flow-kicker">REPÈRE MARCHÉ</span><h4>💶 Valeur de marché</h4></div></div>
          <p>La fiche Radar ne contient pas encore de valeur calculée pour ce dossier. On ne l'invente pas : les comparables et la médiane restent accessibles dans l'estimation.</p>
        </div>`;

    const angle = reasons.length
      ? reasons.slice(0, 2).join(" · ")
      : "Commencer par montrer les ventes réelles et les caractéristiques du secteur avant de parler prix.";

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
          <em>Priorité de prospection</em>
        </div>
      </div>

      <div class="flow-metrics">
        <div><span>⚡ DPE</span><strong>${esc(dpe)}</strong><small>${p.dpeConfirmed === true ? "Confirmé à l'adresse" : "À vérifier"}</small></div>
        <div><span>📊 DVF même adresse</span><strong>${esc(sale.status === "confirmed" ? "Confirmée" : "À vérifier")}</strong><small>${sale.count ? sale.count + " mutation(s)" : "Pas de mutation confirmée"}</small></div>
        <div><span>🎯 Potentiel vendeur</span><strong>${opportunity.toFixed(0)}/100</strong><small>${esc(p.sellerOpportunityLevel || "Lecture marché")}</small></div>
        <div><span>📢 Signal public</span><strong>${signal.toFixed(0)}/100</strong><small>${quality ? "Qualité " + quality + "/5" : "Données à vérifier"}</small></div>
      </div>

      <div class="flow-section flow-section-highlight">
        <div class="flow-section-head">
          <div><span class="flow-kicker">ANGLE D'APPROCHE</span><h4>🎯 Pourquoi commencer par ce dossier ?</h4></div>
          <span class="flow-badge">${score(p).toFixed(1)}/100</span>
        </div>
        <p>${esc(angle)}</p>
        ${reasons.length ? "<ul>" + reasons.slice(0, 3).map((x) => "<li>✓ " + esc(x) + "</li>").join("") + "</ul>" : ""}
      </div>

      ${marketHtml}

      <div class="flow-mini-grid">
        <div><span>📐 Surface</span><strong>${p.area ? Number(p.area).toLocaleString("fr-FR") + " m²" : "—"}</strong></div>
        <div><span>🌳 Terrain</span><strong>${terrain ? Math.round(terrain).toLocaleString("fr-FR") + " m²" : "Non documenté"}</strong></div>
        <div><span>📈 Comparables</span><strong>${comparables || "—"}</strong></div>
        <div><span>💰 Prix actuel</span><strong>${Number.isFinite(price) && price > 0 ? price.toLocaleString("fr-FR") + " €" : "—"}</strong></div>
      </div>

      <div class="flow-seller-pitch">
        <span class="flow-kicker">PHRASE POUR LE PREMIER CONTACT</span>
        <p>« Je peux vous montrer, à partir des ventes réellement enregistrées dans votre secteur, comment positionner votre bien et quels éléments peuvent justifier sa valeur. »</p>
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
            <option>À contacter</option><option>Visité</option><option>À relancer</option>
            <option>Mandat obtenu</option><option>Mandat refusé</option><option>Vendu / abandonné</option>
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

  function renderArgument(data, p, mode){
    const local=data?.local || {};
    const text=String(data?.text || "").trim();
    const reasons=Array.isArray(local.reasons)?local.reasons:[];
    const actions=Array.isArray(local.actions)?local.actions:[];
    const questions=Array.isArray(local.questions)?local.questions:[];
    const objections=Array.isArray(local.objections)?local.objections:[];
    const facts=[];
    const median=Number(p?.medianPriceM2||p?.marketMedianPriceM2||0);
    const central=Number(p?.estimatedValue||p?.valueCentral||p?.marketValue||0);
    const low=Number(p?.priceRangeLow||p?.estimatedLow||p?.rangeLow||0);
    const high=Number(p?.priceRangeHigh||p?.estimatedHigh||p?.rangeHigh||0);
    const sale=p?.sameAddressSale||{};
    if(median) facts.push("Médiane du secteur : "+Math.round(median).toLocaleString("fr-FR")+" €/m².");
    if(central) facts.push("Valeur centrale : "+Math.round(central).toLocaleString("fr-FR")+" €.");
    if(low||high) facts.push("Fourchette indicative : "+(low?Math.round(low).toLocaleString("fr-FR"):"—")+" à "+(high?Math.round(high).toLocaleString("fr-FR"):"—")+" €.");
    if(sale.status==="confirmed") facts.push("Une mutation DVF est confirmée à la même adresse.");
    if(p?.dpeConfirmed===true&&p?.dpe) facts.push("DPE "+p.dpe+" confirmé à l'adresse.");
    if(Number(p?.area)>0) facts.push("Surface : "+Number(p.area).toLocaleString("fr-FR")+" m².");
    if(Number(p?.land||p?.terrainArea)>0) facts.push("Terrain : "+Number(p.land||p.terrainArea).toLocaleString("fr-FR")+" m².");
    const script="« Je ne vais pas vous annoncer un prix au hasard. Je peux vous montrer les ventes réellement enregistrées dans votre secteur, les biens comparables et, lorsque les données le permettent, une fourchette de valeur. L'objectif est de voir ensemble ce qui justifie cette valeur et quels éléments de votre bien peuvent la soutenir. »";
    const sections=[];
    if(text) sections.push('<div class="flow-argument-script"><span class="flow-kicker">TEXTE PRÊT À DIRE</span><p>'+esc(text).replace(/\\n/g,"<br>")+'</p></div>');
    else sections.push('<div class="flow-argument-script"><span class="flow-kicker">TEXTE PRÊT À DIRE</span><p>'+esc(script)+'</p></div>');
    const allFacts=[...reasons,...facts].filter((v,i,a)=>v&&a.indexOf(v)===i);
    if(allFacts.length) sections.push('<div class="flow-argument-block"><strong>📊 Les faits à utiliser</strong><ul>'+allFacts.slice(0,8).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>');
    if(questions.length) sections.push('<div class="flow-argument-block"><strong>❓ Questions à poser</strong><ul>'+questions.slice(0,4).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>');
    else sections.push('<div class="flow-argument-block"><strong>❓ Question à poser</strong><p>« Qu'est-ce qui serait le plus important pour vous si vous envisagiez un jour de faire évoluer votre situation avec ce bien ? »</p></div>');
    if(objections.length) sections.push('<div class="flow-argument-block"><strong>🛡️ Si le propriétaire objecte</strong>'+objections.slice(0,3).map(x=>'<p><b>'+esc(x.objection||"Objection")+'</b><br>'+esc(x.response||"")+'</p>').join("")+'</div>');
    if(actions.length) sections.push('<div class="flow-argument-block"><strong>➡️ Prochaine étape</strong><ul>'+actions.slice(0,3).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>');
    else sections.push('<div class="flow-argument-block"><strong>➡️ Prochaine étape</strong><p>Proposer de présenter les ventes comparables et la méthode de valorisation, sans engagement.</p></div>');
    return '<div class="flow-argument-head"><strong>💬 Argumentaire vendeur</strong><span>'+esc(data?.provider||"IA JML")+'</span></div>'+sections.join("");
  }

  async function aiArgument(p, task) {
    const box = document.getElementById("flowArgument");
    if (!box || !p) return;

    box.innerHTML = '<div class="flow-loading">🧠 Construction de l’argumentaire à partir des données du dossier…</div>';

    try {
      const context =
        "Prépare un argumentaire vendeur utilisable par un agent commercial JML dans les Ardennes. " +
        "Le but est d'expliquer la valeur et les éléments de marché de façon crédible, sans supposer que le propriétaire veut vendre. " +
        "Priorise les ventes DVF, les comparables, la médiane, la fourchette, le DPE confirmé, les caractéristiques du bien, les éléments du secteur et l'historique disponible. " +
        "Ne parle pas de score Radar au propriétaire. Si une donnée manque, dis-le plutôt que de l'inventer.";

      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({task: task || "why", prospect: p, context})
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "IA indisponible");

      box.innerHTML = renderArgument(data, p, task);
    } catch (_) {
      const reasons = Array.isArray(p.priorityProspectionReasons) ? p.priorityProspectionReasons.slice(0, 4) : [];
      const median = Number(p.medianPriceM2 || p.marketMedianPriceM2 || 0);
      const central = Number(p.estimatedValue || p.valueCentral || p.marketValue || 0);
      const low = Number(p.priceRangeLow || p.estimatedLow || p.rangeLow || 0);
      const high = Number(p.priceRangeHigh || p.estimatedHigh || p.rangeHigh || 0);
      const sale = p.sameAddressSale || {};
      const facts = [];
      if(median) facts.push("Médiane du secteur : "+Math.round(median).toLocaleString("fr-FR")+" €/m².");
      if(central) facts.push("Valeur centrale calculée : "+Math.round(central).toLocaleString("fr-FR")+" €.");
      if(low || high) facts.push("Fourchette indicative : "+(low?Math.round(low).toLocaleString("fr-FR"):"—")+" à "+(high?Math.round(high).toLocaleString("fr-FR"):"—")+" €.");
      if(sale.status==="confirmed") facts.push("Une mutation DVF est confirmée à la même adresse.");
      if(p.dpeConfirmed===true && p.dpe) facts.push("DPE "+p.dpe+" confirmé à l'adresse.");
      if(p.area) facts.push("Surface : "+Number(p.area).toLocaleString("fr-FR")+" m².");
      const script = "« Je ne vais pas vous annoncer un prix au hasard. Je peux vous montrer les ventes réellement enregistrées dans votre secteur, les biens comparables et, lorsque les données le permettent, une fourchette de valeur. L’objectif est de voir ensemble ce qui justifie cette valeur et quels éléments de votre bien peuvent la soutenir. »";
      box.innerHTML =
        '<div class="flow-argument-head"><strong>💬 Argumentaire vendeur</strong><span>Mode local</span></div>' +
        '<div class="flow-argument-script"><span class="flow-kicker">TEXTE PRÊT À DIRE</span><p>'+esc(script)+'</p></div>' +
        (facts.length ? '<div class="flow-argument-block"><strong>📊 Faits disponibles</strong><ul>'+facts.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>' : '') +
        (reasons.length ? '<div class="flow-argument-block"><strong>🎯 Pourquoi ce dossier</strong><ul>'+reasons.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></div>' : '');
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
