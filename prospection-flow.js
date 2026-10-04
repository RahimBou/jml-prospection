/* JML Prospection Workflow — Radar → Top 10 → Fiche → Argumentaire → Suivi */
(()=>{
  const escF = v => String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const getProspects = () => {
    try { return JSON.parse(localStorage.getItem("jml_prospection_v1")||"[]"); } catch { return []; }
  };
  const saveProspects = rows => {
    try { localStorage.setItem("jml_prospection_v1", JSON.stringify(rows)); } catch {}
    if(typeof window.render==="function") window.render();
  };
  const score = p => Number(p?.priorityProspectionScore ?? p?.priorityScore ?? p?.futureRadarScore ?? p?.commercialSignalScore ?? 0);
  const level = p => p?.priorityProspectionLevel || (score(p)>=65?"Priorité":"À travailler");
  const label = p => [p?.address||"Adresse à compléter",p?.postalCode,p?.city].filter(Boolean).join(" · ");
  const top10 = () => {
    const radar = Array.isArray(window.futureRadarCandidates) ? window.futureRadarCandidates : [];
    const source = radar.length ? radar : getProspects().filter(p=>typeof window.isCommercialProspect==="function"?window.isCommercialProspect(p):true);
    return source.slice().sort((a,b)=>score(b)-score(a)).slice(0,10);
  };
  const byId = id => getProspects().find(p=>String(p.id)===String(id)) || null;

  function render(){
    const root=document.getElementById("prospectionWorkflow");
    if(!root)return;
    const rows=top10();
    const selectedId=root.dataset.selected || rows[0]?.id || "";
    const selected=rows.find(p=>String(p.id)===String(selectedId)) || byId(selectedId) || rows[0] || null;
    root.innerHTML =
      '<div class="flow-head"><div><span class="flow-kicker">POSTE DE TRAVAIL VENDEUR</span><h2>🎯 De la détection au mandat</h2><p>Une seule chaîne : Radar → 10 priorités → fiche → argumentaire → suivi.</p></div><button id="flowRefresh" class="ghost">↻ Actualiser</button></div>'+
      '<div class="flow-steps"><div class="flow-step active"><b>1</b><strong>RADAR</strong><span>Détection</span></div><div class="flow-arrow">→</div><div class="flow-step active"><b>2</b><strong>TOP 10</strong><span>Priorisation</span></div><div class="flow-arrow">→</div><div class="flow-step active"><b>3</b><strong>FICHE</strong><span>Préparation</span></div><div class="flow-arrow">→</div><div class="flow-step active"><b>4</b><strong>ARGUMENTAIRE</strong><span>Pourquoi agir</span></div><div class="flow-arrow">→</div><div class="flow-step active"><b>5</b><strong>SUIVI</strong><span>Relance</span></div></div>'+
      '<div class="flow-grid"><aside><div class="flow-list-head"><strong>Mes 10 priorités</strong><span>'+rows.length+'/10</span></div>'+
      (rows.length?rows.map((p,i)=>'<button class="flow-prospect '+(String(p.id)===String(selected?.id)?"selected":"")+'" data-flow-id="'+escF(p.id)+'"><span class="flow-rank">#'+(i+1)+'</span><span class="flow-prospect-main"><strong>'+escF(label(p))+'</strong><small>'+escF(p.type||"Bien")+' · '+(p.area?Number(p.area).toLocaleString("fr-FR")+" m²":"surface —")+'</small></span><span class="flow-score">'+score(p).toFixed(1)+'</span></button>').join(""):'<div class="flow-empty">Lance le Radar pour constituer les 10 dossiers prioritaires.</div>')+
      '</aside><section class="flow-detail">'+detailHtml(selected)+'</section></div>';
    bind();
  }

  function detailHtml(p){
    if(!p)return '<div class="flow-empty big">Aucun dossier sélectionné.<br><button class="primary" data-flow-radar>🎯 Ouvrir le Radar</button></div>';
    const reasons=Array.isArray(p.priorityProspectionReasons)?p.priorityProspectionReasons.slice(0,4):Array.isArray(p.reasons)?p.reasons.slice(0,4):[];
    const comps=p.priorityProspectionComponents||p.evidence||{};
    const dpe=p.dpe||"—", sale=p.sameAddressSale||{};
    return '<div class="flow-detail-head"><div><span class="flow-kicker">FICHE PRIORITAIRE</span><h3>'+escF(label(p))+'</h3><p>'+escF([p.type||"Bien",p.area?p.area+" m²":"",p.rooms?p.rooms+" pièces":""].filter(Boolean).join(" · "))+'</p></div><div class="flow-big-score">'+score(p).toFixed(1)+'<small>/100</small><em>'+escF(level(p))+'</em></div></div>'+
      '<div class="flow-metrics"><div><span>DPE</span><strong>'+escF(dpe)+'</strong></div><div><span>DVF même adresse</span><strong>'+escF(sale.status==="confirmed"?"Confirmée":"À vérifier")+'</strong></div><div><span>Comparables</span><strong>'+Number(p.comparableCount||p.comparables?.length||0)+'</strong></div><div><span>Prix</span><strong>'+(p.price?Number(p.price).toLocaleString("fr-FR")+" €":"—")+'</strong></div></div>'+
      '<div class="flow-reasons"><h4>Pourquoi ce dossier est dans le Top 10</h4>'+(reasons.length?reasons.map(x=>'<span>✓ '+escF(x)+'</span>').join(""):'<span>Classement issu des scores déjà calculés par JML.</span>')+'</div>'+
      '<div class="flow-actions"><button class="primary" data-flow-fiche="'+escF(p.id)+'">📋 Ouvrir la fiche</button><button class="ghost" data-flow-argument="'+escF(p.id)+'">💬 Argumentaire vendeur</button><button class="ghost" data-flow-call="'+escF(p.id)+'">📞 Préparer l'appel</button></div>'+
      '<div class="flow-follow"><div><h4>Suivi commercial</h4><p>Le suivi reste manuel : aucune intention de vente n’est déduite automatiquement.</p></div><div class="flow-follow-actions"><select data-flow-status><option value="">Changer le statut…</option><option>À contacter</option><option>Visité</option><option>À relancer</option><option>Mandat obtenu</option><option>Mandat refusé</option><option>Vendu / abandonné</option></select><input data-flow-follow-date type="date" value="'+escF(p.nextFollow||"")+'"><button class="ghost" data-flow-save>💾 Enregistrer le suivi</button></div></div>'+
      '<div id="flowArgument" class="flow-argument"></div>';
  }

  function updateSelected(id){ const root=document.getElementById("prospectionWorkflow"); if(root){root.dataset.selected=id;render();root.scrollIntoView({behavior:"smooth",block:"start"});} }

  async function aiArgument(p,task="why"){
    const box=document.getElementById("flowArgument"); if(!box)return;
    box.innerHTML='<div class="flow-loading">🧠 Préparation de l’argumentaire…</div>';
    try{
      const context="Prépare un argumentaire COMMERCIAL pour un agent commercial immobilier JML qui va parler au vendeur. Explique concrètement pourquoi le bien mérite une discussion sur la valeur et la stratégie de vente, uniquement à partir des données fournies. Ne prétends jamais connaître l'intention du propriétaire. Ne donne pas de données personnelles. Sois court, concret et utilisable à l'oral.";
      const r=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task,prospect:p,context})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.ok===false)throw new Error(data.error||"IA indisponible");
      const text=data.text || data.local?.summary || "Aucun argumentaire généré.";
      box.innerHTML='<div class="flow-argument-head"><strong>💬 Argumentaire vendeur</strong><span>'+escF(data.provider||"IA JML")+'</span></div><div>'+escF(text).replace(/\n/g,"<br>")+'</div>';
    }catch(e){
      const reasons=(p.priorityProspectionReasons||p.reasons||[]).slice(0,3);
      box.innerHTML='<div class="flow-argument-head"><strong>💬 Argumentaire local</strong><span>Sans appel externe</span></div><p>« Je peux vous expliquer la valeur de votre bien à partir de ventes réelles comparables et des caractéristiques de votre secteur. L’objectif est de distinguer le prix affiché, la valeur de marché et la stratégie de mise en vente. »</p>'+(reasons.length?'<ul>'+reasons.map(x=>'<li>'+escF(x)+'</li>').join("")+'</ul>':"");
    }
  }

  function bind(){
    const root=document.getElementById("prospectionWorkflow"); if(!root)return;
    root.querySelectorAll("[data-flow-id]").forEach(b=>b.onclick=()=>updateSelected(b.dataset.flowId));
    const refresh=root.querySelector("#flowRefresh"); if(refresh)refresh.onclick=render;
    const fiche=root.querySelector("[data-flow-fiche]"); if(fiche)fiche.onclick=()=>{const p=byId(fiche.dataset.flowFiche);if(p&&typeof window.openForm==="function")window.openForm(p);};
    const arg=root.querySelector("[data-flow-argument]"); if(arg)arg.onclick=()=>aiArgument(byId(arg.dataset.flowArgument),"why");
    const call=root.querySelector("[data-flow-call]"); if(call)call.onclick=()=>aiArgument(byId(call.dataset.flowCall),"call");
    const radar=root.querySelector("[data-flow-radar]"); if(radar)radar.onclick=()=>document.getElementById("futureRadarPanel")?.scrollIntoView({behavior:"smooth"});
    const save=root.querySelector("[data-flow-save]");
    if(save)save.onclick=()=>{
      const id=root.dataset.selected,p=byId(id);if(!p)return;
      const status=root.querySelector("[data-flow-status]")?.value||"";
      const nextFollow=root.querySelector("[data-flow-follow-date]")?.value||"";
      if(status)p.status=status;
      if(nextFollow)p.nextFollow=nextFollow;
      p.updatedAt=new Date().toISOString();
      p.history=Array.isArray(p.history)?p.history:[];
      p.history.push({date:new Date().toISOString(),type:status||"Suivi",text:status?"Statut : "+status+(nextFollow?" · Relance : "+nextFollow:""):(nextFollow?"Relance planifiée : "+nextFollow:"Mise à jour du suivi")});
      saveProspects(getProspects().map(x=>String(x.id)===String(p.id)?p:x));
      root.dataset.selected=id;render();
    };
  }

  window.addEventListener("load",()=>setTimeout(render,0));
  setInterval(()=>{ if(document.visibilityState==="visible") render(); },30000);
  window.JMLProspectionWorkflow={render,top10};
})();