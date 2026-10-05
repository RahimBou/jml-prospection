/* JML Prospection — Diagnostiqueur terrain V1.0
   Diagnostic non destructif : ne modifie aucune donnée CRM.
*/
(() => {
  "use strict";

  const API = String(window.JML_API_BASE || "https://jml-prospection-web.onrender.com").replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);

  function esc(v="") {
    return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function row(label, state, detail) {
    const icon = state === "ok" ? "✅" : state === "warn" ? "⚠️" : state === "fail" ? "❌" : "⏳";
    return '<div class="jml-diag-row"><span class="jml-diag-state '+state+'">'+icon+'</span><div><strong>'+esc(label)+'</strong><small>'+esc(detail || "")+'</small></div></div>';
  }

  async function timedFetch(url, ms=8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const started = performance.now();
    try {
      const response = await fetch(url, { cache:"no-store", signal:controller.signal });
      const elapsed = Math.round(performance.now() - started);
      let data = null;
      try { data = await response.json(); } catch (_) {}
      return { ok:response.ok, status:response.status, elapsed, data };
    } catch (error) {
      return { ok:false, status:0, elapsed:Math.round(performance.now()-started), error };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runDiagnostic() {
    const out = $("jmlDiagnosticResults");
    const summary = $("jmlDiagnosticSummary");
    if (!out || !summary) return;

    summary.textContent = "Diagnostic en cours…";
    out.innerHTML = row("Préparation", "loading", "Vérification de l’appareil et du serveur JML…");

    const results = [];
    const online = navigator.onLine !== false;
    results.push(row(
      "Connexion Internet",
      online ? "ok" : "fail",
      online ? "Le navigateur indique que la connexion est disponible." : "Le navigateur indique qu’il est hors ligne."
    ));

    let storageOk = true;
    try {
      const k="__jml_diag__";
      localStorage.setItem(k,"1");
      localStorage.removeItem(k);
    } catch (_) { storageOk = false; }
    results.push(row(
      "Stockage local CRM",
      storageOk ? "ok" : "fail",
      storageOk ? "localStorage fonctionne sur cet appareil." : "Le stockage local est bloqué : les prospects peuvent ne pas être enregistrés."
    ));

    const swSupported = "serviceWorker" in navigator;
    let swDetail = swSupported ? "Service Worker disponible." : "Service Worker non disponible dans ce navigateur.";
    let swState = swSupported ? "ok" : "warn";
    if (swSupported) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const active = regs.find(r => r.active);
        if (active) swDetail = "Service Worker actif : "+(active.active.scriptURL || "JML");
        else if (regs.length) { swState="warn"; swDetail="Service Worker enregistré mais pas encore actif."; }
        else { swState="warn"; swDetail="Aucun Service Worker enregistré."; }
      } catch (e) { swState="warn"; swDetail="Impossible de lire le Service Worker."; }
    }
    results.push(row("Application mobile / PWA", swState, swDetail));

    const apiResult = await timedFetch(API + "/api/health", 8000);
    if (apiResult.ok) {
      const version = apiResult.data?.version ? " · version serveur "+apiResult.data.version : "";
      results.push(row("Serveur JML", "ok", "API /api/health répond en "+apiResult.elapsed+" ms"+version+"."));
    } else if (apiResult.status) {
      results.push(row("Serveur JML", "fail", "Réponse HTTP "+apiResult.status+" après "+apiResult.elapsed+" ms. Le problème vient probablement du serveur ou du déploiement."));
    } else {
      const msg = apiResult.error?.name === "AbortError" ? "Délai dépassé (8 s)." : (apiResult.error?.message || "Failed to fetch.");
      results.push(row("Serveur JML", "fail", "Impossible d’atteindre "+API+" : "+msg));
    }

    const radarCity = ($("radarCity")?.value || "Charleville-Mézières").trim();
    if (radarCity) {
      const communeResult = await timedFetch(API + "/api/commune?q=" + encodeURIComponent(radarCity), 8000);
      const commune = communeResult.data?.[0];
      if (commune?.cityCode) {
        const radarProbe = await timedFetch(API + "/api/radar?codeInsee=" + encodeURIComponent(commune.cityCode) + "&limit=1&years=2&zoneMode=1", 20000);
        if (radarProbe.ok) {
          results.push(row("Route Radar", "ok", "Test réel sur "+(commune.city || radarCity)+" · réponse en "+radarProbe.elapsed+" ms."));
        } else if (radarProbe.status) {
          results.push(row("Route Radar", "fail", "HTTP "+radarProbe.status+" après "+radarProbe.elapsed+" ms."));
        } else {
          results.push(row("Route Radar", "fail", "La route Radar ne répond pas : "+(radarProbe.error?.message || "Failed to fetch")+"."));
        }
      } else {
        results.push(row("Ville du Radar", "warn", "Impossible de résoudre « "+radarCity+" » pour tester la route Radar."));
      }
    }

    const integrationResult = await timedFetch(API + "/api/integrations-health", 8000);
    if (integrationResult.ok) {
      results.push(row("Sources externes", "ok", "Le serveur répond au contrôle des intégrations en "+integrationResult.elapsed+" ms."));
    } else if (integrationResult.status) {
      results.push(row("Sources externes", "warn", "Le contrôle des intégrations répond HTTP "+integrationResult.status+"."));
    } else {
      results.push(row("Sources externes", "warn", "Le contrôle des intégrations n’a pas pu être joint. Cela n’empêche pas forcément le radar de fonctionner."));
    }

    const shellChecks = await Promise.all([
      ["Interface index.html", "./index.html"],
      ["JavaScript principal", "./app.js?v=1.50.0"],
      ["Service Worker", "./sw.js"]
    ].map(async ([label,url]) => {
      try {
        const r = await fetch(url, {cache:"no-store"});
        return row(label, r.ok ? "ok" : "fail", r.ok ? "Fichier accessible (HTTP "+r.status+")." : "Fichier inaccessible (HTTP "+r.status+").");
      } catch (e) {
        return row(label, "fail", "Impossible de charger le fichier : "+(e.message || "erreur réseau"));
      }
    }));
    results.push(...shellChecks);

    let diagnosis = "Tout semble opérationnel. Si le Radar échoue malgré tout, relance le diagnostic juste après l’échec : cela permettra de distinguer un problème serveur d’un problème de données du Radar.";
    if (!online) diagnosis = "🔴 Le téléphone est hors ligne. Le Radar ne peut pas contacter le serveur.";
    else if (!apiResult.ok) diagnosis = "🔴 Le serveur JML n’est pas joignable depuis ce téléphone. Inutile de modifier le Radar pour l’instant : il faut vérifier le déploiement Render, le service Node ou le réseau.";
    else if (!shellChecks.every(Boolean)) diagnosis = "🟠 Un fichier de l’application n’est pas accessible. Recharge l’application après le déploiement.";
    else diagnosis = "🟢 Le serveur répond. Si la recherche Radar échoue encore, le problème est probablement spécifique à la route Radar, aux données externes ou à une requête trop longue.";

    out.innerHTML = results.join("");
    summary.innerHTML = "<strong>"+diagnosis+"</strong><small>Diagnostic effectué le "+new Date().toLocaleString("fr-FR")+".</small>";
  }

  function inject() {
    if ($("jmlDiagnosticPanel")) return;

    const radar = $("futureRadarPanel");
    if (!radar) return;

    const actions = radar.querySelector(".future-radar-actions");
    if (actions) {
      const button = document.createElement("button");
      button.id = "jmlDiagnosticBtn";
      button.type = "button";
      button.className = "ghost";
      button.textContent = "🩺 Diagnostiquer";
      button.addEventListener("click", () => {
        $("jmlDiagnosticPanel")?.scrollIntoView({behavior:"smooth", block:"nearest"});
        runDiagnostic();
      });
      actions.appendChild(button);
    }

    const panel = document.createElement("section");
    panel.id = "jmlDiagnosticPanel";
    panel.className = "jml-diagnostic-panel";
    panel.innerHTML =
      '<div class="jml-diag-head"><div><h2>🩺 Diagnostiqueur JML</h2><p>Contrôle la connexion, le serveur, la PWA et les fichiers avant de modifier le Radar.</p></div>'+
      '<button id="jmlDiagnosticRun" type="button" class="primary">Lancer le diagnostic</button></div>'+
      '<div id="jmlDiagnosticSummary" class="jml-diag-summary">Aucun diagnostic lancé.</div>'+
      '<div id="jmlDiagnosticResults" class="jml-diag-results"></div>'+
      '<div class="jml-diag-note">Ce contrôle est sans danger : il ne supprime ni ne modifie les prospects.</div>';

    radar.insertAdjacentElement("afterend", panel);
    $("jmlDiagnosticRun").addEventListener("click", runDiagnostic);
  }

  function style() {
    if ($("jmlDiagnosticStyle")) return;
    const s=document.createElement("style");
    s.id="jmlDiagnosticStyle";
    s.textContent =
      ".jml-diagnostic-panel{margin:14px 0;padding:16px;border:1px solid rgba(23,63,53,.14);border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.05)}"+
      ".jml-diag-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.jml-diag-head h2{margin:0 0 4px;font-size:18px}.jml-diag-head p{margin:0;color:#667085;font-size:13px}.jml-diag-summary{margin:14px 0;padding:12px;border-radius:12px;background:#f5f7f6}.jml-diag-summary strong,.jml-diag-summary small{display:block}.jml-diag-summary small{margin-top:5px;color:#667085}.jml-diag-results{display:grid;gap:7px}.jml-diag-row{display:flex;align-items:flex-start;gap:9px;padding:9px 10px;border:1px solid #edf0ee;border-radius:10px}.jml-diag-state{font-size:16px;line-height:1.2}.jml-diag-row strong,.jml-diag-row small{display:block}.jml-diag-row small{margin-top:2px;color:#667085;font-size:12px;line-height:1.35}.jml-diag-note{margin-top:12px;color:#667085;font-size:11px}.jml-diag-head button{white-space:nowrap}@media(max-width:640px){.jml-diag-head{align-items:stretch;flex-direction:column}.jml-diag-head button{width:100%}}";
    document.head.appendChild(s);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { style(); inject(); });
  } else { style(); inject(); }
})();
