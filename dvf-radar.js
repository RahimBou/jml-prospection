(function(){
  function e(v){return typeof esc==="function"?esc(v):String(v??"")}
  function money(v){return Number(v||0).toLocaleString("fr-FR")+" €"}
  function m2(v){return Number(v||0).toLocaleString("fr-FR")+" m²"}
  function dvfSignal(p){
    const tags=[];
    if(p.date){const age=(Date.now()-new Date(p.date).getTime())/86400000;if(age<=730)tags.push("Vente récente");}
    if(p.value&&p.builtArea)tags.push(Math.round(p.value/p.builtArea).toLocaleString("fr-FR")+" €/m²");
    if(p.landArea>=1000)tags.push("Terrain important");
    return tags;
  }
  window.renderPublicDvf=function(rows){
    publicDvfResults=rows||[];
    const box=document.getElementById("publicDvfResults");
    if(!box)return;
    box.innerHTML=publicDvfResults.length?publicDvfResults.slice(0,20).map((p,i)=>{
      const sig=dvfSignal(p);
      return '<article class="source-result">'+
        '<div><strong>'+e(p.date||"Date inconnue")+'</strong><span>'+e(p.type||"Bien immobilier")+'</span></div>'+
        '<div class="source-result-details">'+(p.value?money(p.value)+" · ":"")+(p.builtArea?m2(p.builtArea)+" bâti · ":"")+(p.landArea?m2(p.landArea)+" terrain":"")+(p.rooms?" · "+p.rooms+" pièces":"")+'</div>'+
        '<div class="meta">'+e(p.address||"")+(p.postalCode?" · "+e(p.postalCode):"")+(p.cityCode?" · INSEE "+e(p.cityCode):"")+'</div>'+
        (sig.length?'<div class="signal">'+sig.map(e).join(" · ")+'</div>':"")+ 
        '<button class="ghost" data-dvf-index="'+i+'">Préparer une fiche</button>'+ 
        '</article>';
    }).join(""):'<div class="meta">Aucune transaction trouvée.</div>';
  };
  document.addEventListener("click",function(ev){
    const b=ev.target.closest("[data-dvf-index]");if(!b)return;
    const p=publicDvfResults[Number(b.dataset.dvfIndex)];if(!p||typeof openForm!=="function")return;
    const typeMap={Maison:"Maison",Appartement:"Appartement",Dépendance:"Autre","Local industriel. commercial ou assimilé":"Local commercial",Terrain:"Terrain"};
    const type=typeMap[p.type]||(/maison/i.test(p.type||"")?"Maison":/appartement/i.test(p.type||"")?"Appartement":/terrain/i.test(p.type||"")?"Terrain":"Autre");
    openForm({address:p.address||"",postalCode:p.postalCode||"",city:p.city||"",type,area:p.builtArea||0,land:p.landArea||0,rooms:p.rooms||0,bedrooms:0,price:p.value||0,dpe:"",status:"Nouveau",detectionDate:today(),nextFollow:"",source:p.source||"DVF Ardennes",externalId:p.mutationId||"",sourceUrl:"https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees",description:"Transaction immobilière publique DVF. Signal de contexte patrimonial ; ne pas interpréter comme identification d'un vendeur.",notes:"Mutation : "+(p.date||"—")+" · Prix : "+(p.value?money(p.value):"—")+" · Parcelle/localisation publique selon les données disponibles."});
  });
})();
