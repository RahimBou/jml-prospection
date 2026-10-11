"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function refreshStatus() {
    const status=$("lbcStatus"),badge=$("lbcModeBadge");
    try {
      const r=await fetch("/api/leboncoin/status",{headers:{Accept:"application/json"},cache:"no-store"});
      const data=await r.json();
      if(!r.ok||!data.ok) throw new Error(data.error||"État indisponible");
      badge.textContent=data.ready?"Flux autorisé":"Auto-test local";
      status.textContent=data.message;
    } catch(e) { status.textContent="Impossible de vérifier le connecteur : "+e.message; badge.textContent="Indisponible"; }
  }
  function render(data) {
    $("lbcCount").textContent=String(Number(data.count)||0);
    $("lbcImported").textContent=String(Number(data.importedCount)||0);
    $("lbcTestState").textContent=data.ok?"Réussi":"Échec";
    $("lbcStatus").textContent=data.message||"Test terminé.";
    $("lbcModeBadge").textContent=data.mode==="authorized_feed_test"?"Flux autorisé":"Auto-test local";
    const rows=Array.isArray(data.items)?data.items:[];
    $("lbcResults").innerHTML=rows.length?rows.map(item=>'<article class="leboncoin-result"><h3>'+esc(item.title||"Annonce sans titre")+'</h3><p><strong>'+esc(item.price_eur==null?"Prix non renseigné":Number(item.price_eur).toLocaleString("fr-FR")+" €")+'</strong> · '+esc(item.property_type||"Type non renseigné")+'</p><p>'+esc(item.surface_m2==null?"Surface non renseignée":item.surface_m2+" m²")+' · '+esc(item.rooms==null?"Pièces non renseignées":item.rooms+" pièces")+'</p><p>'+esc([item.postal_code,item.city].filter(Boolean).join(" "))+' · Vendeur : '+esc(item.seller_type||"non renseigné")+'</p><p>Source : '+esc(item.source||"Leboncoin")+' · Prix affiché (pas une vente signée)</p>'+(item.source_url?'<a href="'+esc(item.source_url)+'" target="_blank" rel="noopener">Ouvrir l’annonce</a>':"")+'</article>').join(""):'<div class="empty">Aucune annonce normalisée. Consulte le message ci-dessus.</div>';
  }
  async function runTest() {
    const btn=$("lbcTestBtn");
    btn.disabled=true;btn.textContent="Test en cours…";
    $("lbcTestState").textContent="En cours";
    try {
      const r=await fetch("/api/leboncoin/test",{headers:{Accept:"application/json"},cache:"no-store"});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||"Le test a échoué");
      render(data);
    } catch(e) {
      $("lbcStatus").textContent="Échec du test : "+e.message;
      $("lbcTestState").textContent="Échec";
      $("lbcResults").innerHTML='<div class="empty">Le test n’a pas abouti.</div>';
    } finally {btn.disabled=false;btn.textContent="▶ Tester le connecteur";}
  }
  $("lbcTestBtn")?.addEventListener("click",runTest);
  $("lbcRefreshBtn")?.addEventListener("click",refreshStatus);
  refreshStatus();
})();