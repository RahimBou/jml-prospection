const APP_VERSION="1.22.5";
const KEY="jml_prospection_v1";let prospects=load(),pendingImport=[];let prospectPage=1;let prospectTotalPages=1;const DEFAULT_PROSPECT_PAGE_SIZE=8;const $=id=>document.getElementById(id);
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(x)?x:[]}catch(e){return[]}}
function save(){localStorage.setItem(KEY,JSON.stringify(prospects));render();if(typeof statsSync==="function")statsSync()}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function now(){return new Date().toISOString()}
function today(){return new Date().toISOString().slice(0,10)}
function norm(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/œ/g,"oe").replace(/æ/g,"ae").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function dedupeKey(p){const ext=norm(p.externalId||"");if(ext)return "ext|"+norm(p.source||"")+"|"+ext;const cp=String(p.postalCode||"").replace(/\D/g,"");return [norm(p.address),cp,norm(p.city),norm(p.type)].filter(Boolean).join("|")}
function num(v){return Number(v)||0}
function openForm(item=null){$("prospectForm").reset();$("editId").value=item?.id||"";$("dialogTitle").textContent=item?"Modifier le prospect":"Nouveau prospect";$("history").innerHTML=item&&item.history?.length?item.history.slice().reverse().map(h=>'<div class="history-item"><strong>'+esc(h.type)+'</strong><span>'+new Date(h.date).toLocaleString("fr-FR")+'</span><p>'+esc(h.text)+'</p></div>').join(""):"<div class='meta'>Aucun historique.</div>";if(item){for(const k of ["address","postalCode","district","area","land","rooms","bedrooms","price","dpe","detectionDate","nextFollow","source","externalId","sourceUrl","description","notes"])if($(k))$(k).value=item[k]??"";$("formCity").value=item.city||"";$("formType").value=item.type||"Maison";$("formStatus").value=item.status||"Nouveau"}else $("detectionDate").value=today();$("dialog").showModal()}
function closeForm(){$("dialog").close()}
function formData(){return{address:$("address").value.trim(),postalCode:$("postalCode").value.trim(),city:$("formCity").value.trim(),district:$("district").value.trim(),type:$("formType").value,area:num($("area").value),land:num($("land").value),rooms:num($("rooms").value),bedrooms:num($("bedrooms").value),price:num($("price").value),dpe:$("dpe").value,status:$("formStatus").value,detectionDate:$("detectionDate").value,nextFollow:$("nextFollow").value,source:$("source").value.trim(),externalId:$("externalId").value.trim(),sourceUrl:$("sourceUrl").value.trim(),description:$("description").value.trim(),notes:$("notes").value.trim()}}
function ensureHistory(p){p.priceHistory=Array.isArray(p.priceHistory)?p.priceHistory:[];p.appearanceHistory=Array.isArray(p.appearanceHistory)?p.appearanceHistory:[];if(p.price&&p.priceHistory.length===0)p.priceHistory.push({date:p.createdAt||now(),price:p.price,source:p.source||"",reason:"Création"});if(!p.firstDetectedAt)p.firstDetectedAt=p.detectionDate||String(p.createdAt||now()).slice(0,10);if(!p.lastSeenAt)p.lastSeenAt=p.updatedAt||p.createdAt||now();return p}
function priceChangeInfo(p){ensureHistory(p);const h=p.priceHistory||[];if(h.length<2)return null;const prev=h[h.length-2],cur=h[h.length-1];if(!prev.price||!cur.price||prev.price===cur.price)return null;return{previous:prev.price,current:cur.price,delta:cur.price-prev.price,pct:((cur.price-prev.price)/prev.price)*100,date:cur.date}}
function signalInfo(p){ensureHistory(p);const tags=[],nowMs=Date.now(),detected=p.detectionDate?new Date(p.detectionDate+"T00:00:00").getTime():p.createdAt?new Date(p.createdAt).getTime():nowMs,age=Math.max(0,Math.floor((nowMs-detected)/86400000));if(age<=7)tags.push({key:"new",label:"Nouveau détecté",points:3});if(age>=60)tags.push({key:"old",label:"Fiche ancienne",points:2});if(p.nextFollow&&new Date(p.nextFollow+"T23:59:59").getTime()<nowMs&&!["Vendu / abandonné","Mandat obtenu"].includes(p.status))tags.push({key:"follow",label:"Relance en retard",points:3});if(["F","G"].includes(p.dpe))tags.push({key:"dpe",label:"DPE F/G",points:2});if(p.land>=1000)tags.push({key:"land",label:"Terrain important",points:2});const sources=new Set((p.appearanceHistory||[]).map(a=>a.source).filter(Boolean));if(sources.size>=2)tags.push({key:"multi",label:"Sources multiples",points:3});const pc=priceChangeInfo(p);if(pc&&pc.delta<0)tags.push({key:"priceDown",label:"Baisse de prix",points:4});if(pc&&pc.delta>0)tags.push({key:"priceUp",label:"Hausse de prix",points:0});const quality=p.dataQuality?.level||((p.futureRadarScore!=null&&p.address&&p.postalCode&&p.area&&p.dpe)?"sufficient":((p.price&&p.area&&p.postalCode)?"complete":"incomplete"));if(quality==="incomplete")tags.push({key:"incomplete",label:"Données à compléter",points:1});else if(quality==="sufficient")tags.push({key:"sufficient",label:"Données suffisantes",points:0});return{tags,score:tags.reduce((n,t)=>n+t.points,0),priceChange:pc}}
function priceM2(p){return p.price&&p.area?p.price/p.area:0}
function movement6mInfo(p){
 ensureHistory(p);
 const tags=[], h=p.priceHistory||[], a=p.appearanceHistory||[], nowMs=Date.now();
 const detected=p.detectionDate?new Date(p.detectionDate+"T00:00:00").getTime():p.createdAt?new Date(p.createdAt).getTime():nowMs;
 const age=Math.max(0,Math.floor((nowMs-detected)/86400000));
 const pc=priceChangeInfo(p);
 const priceChanges=Math.max(0,h.length-1);
 const sources=new Set(a.map(x=>x.source).filter(Boolean));
 if(pc&&pc.delta<0){
   const pct=Math.abs(pc.pct);
   tags.push({key:"priceDown",label:"Baisse de prix",points:pct>=10?22:15});
 }
 if(priceChanges>=2)tags.push({key:"repeatedPrice",label:"Plusieurs changements de prix",points:15});
 const appearanceDates=a.map(x=>new Date(x.date||0).getTime()).filter(Number.isFinite).sort((x,y)=>x-y);
 const distinctAppearanceDays=new Set(a.map(x=>String(x.date||"").slice(0,10)).filter(Boolean)).size;
 if(a.length>=3&&distinctAppearanceDays>=2&&appearanceDates[appearanceDates.length-1]-appearanceDates[0]>=7*86400000)tags.push({key:"repeatedAppearance",label:"Présence répétée dans les sources",points:10});
 if(sources.size>=2)tags.push({key:"multiSource",label:"Présent sur plusieurs sources",points:10});
 if(age>=90)tags.push({key:"old",label:"Bien ancien dans le suivi",points:10});
 if(p.dpe&&["F","G"].includes(p.dpe))tags.push({key:"dpe",label:"DPE F/G",points:8});
 if(p.nextFollow&&new Date(p.nextFollow+"T23:59:59").getTime()<nowMs&&!["Vendu / abandonné","Mandat obtenu"].includes(p.status))tags.push({key:"follow",label:"Relance à traiter",points:5});
 if(a.length>=2){
   const dates=a.map(x=>new Date(x.date||0).getTime()).filter(Number.isFinite).sort((x,y)=>x-y);
   if(dates.length>=2&&dates[dates.length-1]-dates[0]>=90*86400000)tags.push({key:"longHistory",label:"Historique sur plusieurs mois",points:10});
 }
 const score=Math.min(100,tags.reduce((n,t)=>n+t.points,0));
 let level="Faible signal",cls="low";
 if(score>=65){level="Priorité de suivi";cls="high"}
 else if(score>=40){level="Potentiel de mouvement";cls="medium"}
 else if(score>=20){level="À surveiller";cls="watch"}
 return {score,level,cls,tags,priceChange:pc,historyCount:h.length,appearanceCount:a.length};
}
function movement6mHtml(p){
 const m=movement6mInfo(p);
 if(!m.score)return '<div class="movement-box low"><div><strong>Indice comportemental à 6 mois</strong><span>Faible signal</span></div><div class="movement-score">0/100</div></div>';
 return '<div class="movement-box '+m.cls+'"><div><strong>Indice comportemental à 6 mois</strong><span>'+esc(m.level)+'</span><small>Indice basé sur l’historique du prospect — il ne s’agit pas d’une prédiction de vente.</small></div><div class="movement-score">'+m.score+'/100</div></div>'+(Number.isFinite(Number(p.futureRadarScore))?'<div class="meta">Score radar : <strong>'+Math.round(Number(p.futureRadarScore))+'/100</strong></div>':'')+'<div class="movement-reasons">'+m.tags.map(t=>'<span>'+esc(t.label)+' · +'+t.points+'</span>').join("")+'</div>';
}
function hasSignal(p){return signalInfo(p).tags.some(t=>t.points>0)||Boolean(String(p.description||"").trim())}
function priceHistoryHtml(p){ensureHistory(p);const pc=priceChangeInfo(p);if(!p.priceHistory?.length)return"";return '<section class="price-history"><div class="price-history-head"><strong>Historique du prix</strong>'+(pc?(pc.delta<0?'<span class="price-down">▼ Baisse de '+Math.abs(pc.pct).toFixed(1)+' %</span>':'<span class="price-up">▲ Hausse de '+pc.pct.toFixed(1)+' %</span>'):"")+'</div><div class="price-history-list">'+p.priceHistory.slice().reverse().map(h=>'<div><span>'+new Date(h.date).toLocaleDateString("fr-FR")+'</span><strong>'+Number(h.price).toLocaleString("fr-FR")+' €</strong><em>'+esc(h.reason||"")+'</em></div>').join("")+'</div></section>'}
function inRange(value,min,max){if(min!==""&&value<num(min))return false;if(max!==""&&value>num(max))return false;return true}
function isRadarSurveillance(p){
 const source=String(p?.source||"").toLowerCase();
 const status=String(p?.status||"");
 const description=String(p?.description||"").toLowerCase();
 const notes=String(p?.notes||"").toLowerCase();
 const radarSource=source.includes("radar surveillance")||source.includes("radar futur");
 const radarText=description.includes("cible de surveillance")||description.includes("aucun signal commercial public")||notes.includes("cible de surveillance");
 const radarScore=Number(p?.futureRadarScore);
 const commercialScore=Number(p?.commercialSignalScore||0);
 return radarSource || (status==="Pas encore en vente" && commercialScore<=0 && Number.isFinite(radarScore) && (radarText||source.includes("ademe")||source.includes("dvf")));
}
function isCommercialProspect(p){return !isRadarSurveillance(p)}
function dashboardTerrain(){
 const nowMs=Date.now(), weekMs=7*86400000, recentMs=14*86400000;
 const active=p=>!["Vendu / abandonné","Mandat obtenu"].includes(p.status);
 const work=prospects.filter(p=>active(p)&&isCommercialProspect(p));
 const priority=work.filter(p=>movement6mInfo(p).score>=65).length;
 const recent=work.filter(p=>signalInfo(p).tags.some(t=>t.key==="new")).length;
 const addressReady=work.filter(p=>p.address&&p.postalCode&&p.city).length;
 const addressMissing=work.filter(p=>!p.address||!p.postalCode||!p.city).length;
 const follow=work.filter(p=>p.nextFollow&&new Date(p.nextFollow+"T23:59:59").getTime()<nowMs).length;
 const changes=work.filter(p=>{const t=new Date(p.updatedAt||p.createdAt||0).getTime();return Number.isFinite(t)&&nowMs-t<=recentMs&&signalInfo(p).tags.some(x=>x.key==="priceDown");}).length;
 const weekNew=work.filter(p=>{const t=new Date(p.detectionDate||p.createdAt||0).getTime();return Number.isFinite(t)&&nowMs-t<=weekMs;}).length;
 const weekFollow=work.reduce((n,p)=>n+(p.history||[]).filter(h=>{const t=new Date(h.date||0).getTime();const text=String((h.type||"")+" "+(h.text||"")).toLowerCase();return Number.isFinite(t)&&nowMs-t<=weekMs&&text.includes("relance");}).length,0);
 const readyVisit=Math.min(10,work.filter(p=>p.address&&p.postalCode&&p.city&&p.sourceUrl).length);
 const byCity={};work.forEach(p=>{const city=String(p.city||"").trim();if(city)byCity[city]=(byCity[city]||0)+1});
 const sectors=Object.entries(byCity).sort((a,b)=>b[1]-a[1]).slice(0,5);
 $("dashboardTerrain").innerHTML='<div class="dashboard-head"><div><h2>🎯 À faire maintenant</h2><p>Vue opérationnelle des prospects commerciaux. Les biens de surveillance restent séparés.</p></div><div class="dashboard-head-actions"><span class="dashboard-badge">'+priority+' priorité'+(priority>1?'s':'')+' terrain</span><button type="button" class="ghost dashboard-toggle" data-dashboard-toggle aria-expanded="false">▸ Afficher</button></div></div><div class="dashboard-collapsible" hidden><div class="dashboard-actions-grid"><button class="dashboard-action action-hot" data-dashboard-action="priority"><strong>🔥 '+priority+'</strong><span>Priorités terrain</span><small>Indice ≥ 65</small></button><button class="dashboard-action" data-dashboard-action="recent"><strong>🆕 '+recent+'</strong><span>Nouveaux récents</span><small>Détectés ≤ 7 jours</small></button><button class="dashboard-action" data-dashboard-action="address"><strong>📍 '+addressMissing+'</strong><span>Adresses à compléter</span><small>Informations manquantes</small></button><button class="dashboard-action" data-dashboard-action="follow"><strong>📞 '+follow+'</strong><span>Relances en retard</span><small>À traiter maintenant</small></button><button class="dashboard-action" data-dashboard-action="changes"><strong>🔄 '+changes+'</strong><span>Baisses de prix récentes</span><small>Changement public détecté</small></button><button class="dashboard-action" data-dashboard-action="tour"><strong>🚗 '+readyVisit+'</strong><span>Biens prêts terrain</span><small>Adresse + source publique</small></button></div><div class="dashboard-lower"><div class="dashboard-box"><h3>🗺️ Secteurs actifs</h3>'+(sectors.length?sectors.map(([city,n])=>'<button class="sector-row" data-dashboard-city="'+esc(city)+'"><span>'+esc(city)+'</span><strong>'+n+'</strong></button>').join(""):'<div class="meta">Aucun prospect commercial renseigné.</div>')+'</div><div class="dashboard-box"><h3>📊 Activité récente</h3><div class="activity-row"><span>Nouveaux cette semaine</span><strong>'+weekNew+'</strong></div><div class="activity-row"><span>Fiches avec adresse exploitable</span><strong>'+addressReady+'</strong></div><div class="activity-row"><span>Relances enregistrées cette semaine</span><strong>'+weekFollow+'</strong></div><div class="activity-row"><span>Total prospects commerciaux actifs</span><strong>'+work.length+'</strong></div></div></div><div class="dashboard-note">Les biens issus du Radar sans signal commercial ne sont pas comptés comme prospects commerciaux : ils restent disponibles dans « Biens à surveiller ».</div></div>';
}


async function initRadarTerritory(){
  const select=$("radarTerritoryCity"),add=$("radarAddSector"),count=$("radarTerritoryCount"),list=$("radarSectorList");
  if(!select||!add||!list||select.dataset.ready)return;
  select.dataset.ready="1";
  try{
    const data=await publicJson("/api/territory?department=08");
    window.radarTerritoryCommunes=data.communes||[];
    if(count)count.textContent=data.communeCount+" communes disponibles";
    select.innerHTML='<option value="">+ Ajouter une commune comme secteur…</option>'+window.radarTerritoryCommunes.map(c=>'<option value="'+apiEsc(c.city)+'">'+apiEsc(c.city)+(c.population?" · "+Number(c.population).toLocaleString("fr-FR")+" hab.":"")+'</option>').join("");
  }catch(e){
    if(count)count.textContent="Référentiel Ardennes indisponible";
    return;
  }
  add.onclick=()=>{
    const city=select.value;
    if(!city)return;
    if([...document.querySelectorAll("[data-radar-sector]")].some(x=>(x.dataset.label||"").toLowerCase()===city.toLowerCase())){select.value="";return}
    const id="custom-"+Date.now();
    const row=document.createElement("label");
    row.className="radar-sector-row";
    row.setAttribute("data-radar-sector-row","");
    row.innerHTML='<span class="radar-sector-check"><input type="checkbox" data-radar-sector value="'+apiEsc(id)+'" data-label="'+apiEsc(city)+'" checked><strong>'+apiEsc(city)+'</strong></span><select data-radar-radius aria-label="Rayon '+apiEsc(city)+'"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="20">20 km</option><option value="25">25 km</option><option value="30">30 km</option><option value="40">40 km</option></select><button type="button" class="radar-remove-sector" title="Retirer">×</button>';
    list.appendChild(row);
    select.value="";
    const remove=row.querySelector(".radar-remove-sector");
    remove.onclick=()=>row.remove();
    const total=list.querySelectorAll("[data-radar-sector]").length;
    $("futureRadarReady").textContent=total+" secteur(s) prêt(s) à être analysé(s)";
  };
  list.querySelectorAll(".radar-remove-sector").forEach(btn=>btn.onclick=()=>btn.closest("[data-radar-sector-row]")?.remove());
}

function initRadarCommuneInput(){
 const input=$("futureRadarQuery"),status=$("futureRadarReady");
 if(!input||input.dataset.ready)return;
 input.dataset.ready="1";
 let timer=null;
 input.addEventListener("input",()=>{
   clearTimeout(timer);
   const value=input.value.trim();
   if(status) status.textContent=value?"🔎 Commune prête à être vérifiée":"En attente d'une commune";
   timer=setTimeout(async()=>{
     if(!value)return;
     try{
       const rows=await publicJson("/api/commune?q="+encodeURIComponent(value));
       const hit=rows?.[0];
       if(hit?.city){
         if(status) status.textContent="✅ Commune reconnue : "+hit.city;
       }else if(status) status.textContent="⚠️ Commune à vérifier";
     }catch(e){ if(status) status.textContent="Commune à vérifier avant analyse"; }
   },450);
 });
 input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("futureRadarBtn")?.click();}});
}
function initFutureRadarResultsToggle(){
 const toggle=$("futureRadarToggle"),box=$("futureRadarResults");
 if(!toggle||!box||toggle.dataset.ready)return;
 toggle.dataset.ready="1";
 toggle.onclick=()=>{
   const open=box.hidden;
   box.hidden=!open;
   toggle.setAttribute("aria-expanded",String(open));
   toggle.textContent=open?"✕ Masquer les biens détectés":"▸ Afficher les "+futureRadarCandidates.length+" biens détectés";
 };
}
function initCollapsiblePanels(){
 const advancedToggle=$("advancedSearchToggle"),advancedBody=$("advancedSearchBody");
 if(advancedToggle&&advancedBody){
   advancedToggle.onclick=()=>{const open=advancedBody.hidden;advancedBody.hidden=!open;advancedToggle.setAttribute("aria-expanded",String(open));advancedToggle.textContent=open?"✕ Fermer les filtres":"🔎 Ouvrir les filtres"};
 }
 const dashboard=$("dashboardTerrain");
 if(dashboard&&!dashboard.dataset.collapsibleReady){
   dashboard.dataset.collapsibleReady="1";
   dashboard.addEventListener("click",e=>{const b=e.target.closest("[data-dashboard-toggle]");if(!b)return;const body=dashboard.querySelector(".dashboard-collapsible");if(!body)return;const open=body.hidden;body.hidden=!open;b.setAttribute("aria-expanded",String(open));b.textContent=open?"✕ Fermer":"▸ Afficher"});
 }
 initFutureRadarResultsToggle();
}
function render(){
 const prospectView=$("prospectView")?.value||"commercial";
 const viewBase=prospectView==="watch"?prospects.filter(isRadarSurveillance):prospectView==="all"?prospects:prospects.filter(isCommercialProspect);
 const q=$("q").value.toLowerCase().trim(),city=$("city").value.toLowerCase().trim(),district=$("districtFilter").value.toLowerCase().trim(),type=$("type").value,status=$("status").value,dpe=$("dpeFilter").value,signal=$("signalFilter").value,movement=$("movementFilter").value;
 const priceMin=$("priceMin").value,priceMax=$("priceMax").value,areaMin=$("areaMin").value,areaMax=$("areaMax").value,landMin=$("landMin").value,landMax=$("landMax").value,roomsMin=$("roomsMin").value,roomsMax=$("roomsMax").value,from=$("detectedFrom").value,to=$("detectedTo").value;
 let rows=viewBase.filter(p=>{
  const hay=[p.address,p.postalCode,p.city,p.district,p.description,p.notes,p.source,p.externalId].join(" ").toLowerCase();
  const detected=p.detectionDate||String(p.createdAt||"").slice(0,10);
  return (!q||hay.includes(q))&&(!city||String(p.city||"").toLowerCase().includes(city))&&(!district||String(p.district||"").toLowerCase().includes(district))&&(!type||p.type===type)&&(!status||p.status===status)&&(!dpe||(dpe==="Non renseigné"?!p.dpe:p.dpe===dpe))&&(!signal||(signal==="any"?hasSignal(p):signal==="none"?!hasSignal(p):signalInfo(p).tags.some(t=>t.key===signal)))&&(!movement||(movement==="high"?movement6mInfo(p).score>=65:movement==="medium"?movement6mInfo(p).score>=40&&movement6mInfo(p).score<65:movement==="watch"?movement6mInfo(p).score>=20&&movement6mInfo(p).score<40:movement6mInfo(p).score<20))&&inRange(p.price,priceMin,priceMax)&&inRange(p.area,areaMin,areaMax)&&inRange(p.land,landMin,landMax)&&inRange(p.rooms,roomsMin,roomsMax)&&(!from||detected>=from)&&(!to||detected<=to);
 });
 const sort=$("sort").value;
 if(sort==="signal")rows.sort((a,b)=>movement6mInfo(b).score-movement6mInfo(a).score||signalInfo(b).score-signalInfo(a).score||String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));else if(sort==="city")rows.sort((a,b)=>String(a.city).localeCompare(String(b.city)));else if(sort==="price")rows.sort((a,b)=>b.price-a.price);else if(sort==="priceM2")rows.sort((a,b)=>priceM2(b)-priceM2(a));else if(sort==="area")rows.sort((a,b)=>b.area-a.area);else if(sort==="follow")rows.sort((a,b)=>(a.nextFollow||"9999").localeCompare(b.nextFollow||"9999"));else if(sort==="detection")rows.sort((a,b)=>(b.detectionDate||b.createdAt||"").localeCompare(a.detectionDate||a.createdAt||""));else rows.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
 const pageSize=Math.max(1,Number($("prospectPageSize")?.value)||DEFAULT_PROSPECT_PAGE_SIZE);const totalPages=Math.max(1,Math.ceil(rows.length/pageSize));prospectTotalPages=totalPages;if(prospectPage>totalPages)prospectPage=totalPages;const pageStart=(prospectPage-1)*pageSize;const pageRows=rows.slice(pageStart,pageStart+pageSize);$("resultCount").textContent=rows.length+" résultat"+(rows.length>1?"s":"");$("prospectRange").textContent=rows.length?("Affichage "+(pageStart+1)+"–"+Math.min(pageStart+pageRows.length,rows.length)+" sur "+rows.length):"0 résultat affiché";$("empty").style.display=rows.length?"none":"block";
 $("list").innerHTML=pageRows.map(p=>'<article class="card"><div class="card-head"><div><div class="address">'+esc(p.address)+'</div><div class="meta">'+esc(p.postalCode?p.postalCode+" ":"")+esc(p.city)+(p.district?" · "+esc(p.district):"")+" · "+esc(p.type)+'</div></div><span class="badge '+badgeClass(p.status)+'">'+esc(p.status)+'</span></div>'+(p.price?'<div class="price">'+p.price.toLocaleString("fr-FR")+' €</div>':"")+'<div class="details">'+(p.area?'<span class="detail">'+p.area+' m²</span>':"")+(p.land?'<span class="detail">Terrain '+p.land+' m²</span>':"")+(p.rooms?'<span class="detail">'+p.rooms+' pièces</span>':"")+(p.bedrooms?'<span class="detail">'+p.bedrooms+' ch.</span>':"")+(p.dpe?'<span class="detail">DPE '+esc(p.dpe)+'</span>':'<span class="detail">DPE —</span>')+(priceM2(p)?'<span class="detail">'+Math.round(priceM2(p)).toLocaleString("fr-FR")+' €/m²</span>':"")+(p.source?'<span class="detail">'+esc(p.source)+'</span>':"")+'</div>'+(p.description?'<div class="signal">'+esc(p.description)+'</div>':"")+'<div class="meta">Détection : '+(p.detectionDate?new Date(p.detectionDate+"T00:00:00").toLocaleDateString("fr-FR"):"non définie")+' · Relance : '+(p.nextFollow?new Date(p.nextFollow+"T00:00:00").toLocaleDateString("fr-FR"):"non définie")+'</div>'+signalInfo(p).tags.filter(t=>t.points>0).map(t=>'<span class="signal-tag">'+esc(t.label)+(t.key==="priceDown"&&signalInfo(p).priceChange?' · '+Math.abs(signalInfo(p).priceChange.pct).toFixed(1)+' %':"")+'</span>').join("")+movement6mHtml(p)+priceHistoryHtml(p)+'<div class="card-actions"><button class="ghost" data-edit="'+p.id+'">Ouvrir / modifier</button>'+(p.sourceUrl?'<a class="ghost" href="'+esc(p.sourceUrl)+'" target="_blank" rel="noopener">Source</a>':"")+'<button class="ghost" data-delete="'+p.id+'">Supprimer</button></div></article>').join("");
 dashboardTerrain();const commercial=prospects.filter(isCommercialProspect),surveillance=prospects.filter(isRadarSurveillance);$("statTotal").textContent=commercial.length;$("statNew").textContent=commercial.filter(p=>p.status==="Nouveau").length;$("statFollow").textContent=commercial.filter(p=>p.status==="À relancer").length;$("statSignals").textContent=surveillance.length;const totalSignals=commercial.reduce((n,p)=>n+signalInfo(p).score,0),movementHigh=commercial.filter(p=>movement6mInfo(p).score>=65).length,movementMedium=commercial.filter(p=>movement6mInfo(p).score>=40&&movement6mInfo(p).score<65).length; $("radarSummary").textContent=totalSignals+" points de signal · "+movementHigh+" priorité"+(movementHigh>1?"s":"")+" / "+movementMedium+" potentiels";$("signalChips").innerHTML=["new","old","follow","dpe","land","multi","priceDown","incomplete","sufficient"].map(k=>{const n=commercial.filter(p=>signalInfo(p).tags.some(t=>t.key===k)).length;const label={new:"Nouveaux",old:"Anciens",follow:"Relances en retard",dpe:"DPE F/G",land:"Terrains importants",multi:"Sources multiples",priceDown:"Baisses de prix",incomplete:"Données à compléter",sufficient:"Données suffisantes"}[k];return n?"<button class=\"signal-chip\" data-signal=\""+k+"\">"+label+" · "+n+"</button>":""}).join("");if($("prospectsTitle"))$("prospectsTitle").textContent=prospectView==="watch"?"Biens à surveiller":prospectView==="all"?"Tous les biens":"Prospects commerciaux";if($("prospectsViewNote"))$("prospectsViewNote").textContent=prospectView==="watch"?"Ces biens proviennent principalement du Radar DPE/DVF. Ils sont à surveiller et ne constituent pas, à eux seuls, un signal de vente.":prospectView==="all"?"Vue complète du CRM : prospects commerciaux et biens de surveillance.":"Les biens issus du Radar sans signal commercial restent séparés dans « Biens à surveiller »."
}
function badgeClass(s){return s==="Mandat obtenu"?"green":s==="À relancer"?"hot":""}
function mergeProspect(incoming){const key=dedupeKey(incoming),idx=prospects.findIndex(p=>dedupeKey(p)===key),date=now();if(idx<0){const created={id:crypto.randomUUID(),...incoming,detectionDate:incoming.detectionDate||today(),history:[{date,type:"Import CSV",text:"Bien importé dans la base."}],priceHistory:incoming.price?[{date,price:incoming.price,source:incoming.source||"",reason:"Création"}]:[],appearanceHistory:[{date,source:incoming.source||"",sourceUrl:incoming.sourceUrl||"",externalId:incoming.externalId||""}],firstDetectedAt:incoming.detectionDate||today(),lastSeenAt:date,createdAt:date,updatedAt:date};prospects.push(created);return"created"}const old=ensureHistory({...prospects[idx]}),history=[...(old.history||[])];history.push({date,type:"Mise à jour source",text:incoming.source?"Données reçues depuis "+incoming.source+".":"Données importées et fusionnées."});const merged={...old};const oldPrice=num(old.price),newPrice=num(incoming.price);for(const[k,v]of Object.entries(incoming)){if(v!==""&&v!==null&&v!==undefined&&(typeof v!=="number"||v!==0))merged[k]=v}if(newPrice&&newPrice!==oldPrice){merged.priceHistory=[...(old.priceHistory||[]),{date,price:newPrice,previousPrice:oldPrice,source:incoming.source||"",reason:"Changement de prix"}];history.push({date,type:"Changement de prix",text:(oldPrice?oldPrice.toLocaleString("fr-FR")+" € → ":"")+" "+newPrice.toLocaleString("fr-FR")+" €"});}const appearance={date,source:incoming.source||"",sourceUrl:incoming.sourceUrl||"",externalId:incoming.externalId||""};const last=(old.appearanceHistory||[])[(old.appearanceHistory||[]).length-1];if(!last||[appearance.source,appearance.sourceUrl,appearance.externalId].some((v,i)=>v!==[last.source,last.sourceUrl,last.externalId][i]))merged.appearanceHistory=[...(old.appearanceHistory||[]),appearance];merged.history=history;merged.lastSeenAt=date;merged.updatedAt=date;prospects[idx]=merged;return"merged"}
$("addBtn").onclick=()=>openForm();$("closeBtn").onclick=closeForm;$("cancelBtn").onclick=closeForm;
$("prospectForm").onsubmit=e=>{e.preventDefault();const d=formData(),id=$("editId").value,action=$("actionNote").value.trim(),date=now();if(!d.address||!d.city)return;if(id){const i=prospects.findIndex(p=>p.id===id);if(i<0)return;const old=prospects[i],history=[...(old.history||[])];if(old.status!==d.status)history.push({date,type:"Changement de statut",text:old.status+" → "+d.status});if(action)history.push({date,type:"Action / note",text:action});const updated=ensureHistory({...old,...d});if(num(old.price)!==num(d.price)&&num(d.price)){updated.priceHistory=[...(old.priceHistory||[]),{date,price:num(d.price),previousPrice:num(old.price),source:d.source||"",reason:"Changement de prix"}];history.push({date,type:"Changement de prix",text:(old.price?num(old.price).toLocaleString("fr-FR")+" € → ":"")+" "+num(d.price).toLocaleString("fr-FR")+" €"});}updated.appearanceHistory=old.appearanceHistory?.length?old.appearanceHistory:[{date,source:d.source||"",sourceUrl:d.sourceUrl||"",externalId:d.externalId||""}];updated.history=history;updated.updatedAt=date;updated.lastSeenAt=date;prospects[i]=updated}else{const duplicate=prospects.find(p=>dedupeKey(p)===dedupeKey(d));if(duplicate){alert("Ce bien existe déjà dans la base. Ouvre sa fiche pour le modifier.");openForm(duplicate);return}prospects.push({id:crypto.randomUUID(),...d,history:[{date,type:"Création",text:action||"Prospect créé"}],priceHistory:d.price?[{date,price:d.price,source:d.source||"",reason:"Création"}]:[],appearanceHistory:[{date,source:d.source||"",sourceUrl:d.sourceUrl||"",externalId:d.externalId||""}],firstDetectedAt:d.detectionDate||today(),lastSeenAt:date,createdAt:date,updatedAt:date})}save();closeForm()};
$("resetBtn").onclick=()=>{["q","city","districtFilter","type","status","dpeFilter","signalFilter","movementFilter","priceMin","priceMax","areaMin","areaMax","landMin","landMax","roomsMin","roomsMax","detectedFrom","detectedTo"].forEach(id=>$(id).value="");prospectPage=1;render()};
["q","city","districtFilter","type","status","dpeFilter","signalFilter","movementFilter","priceMin","priceMax","areaMin","areaMax","landMin","landMax","roomsMin","roomsMax","detectedFrom","detectedTo","sort"].forEach(id=>$(id).addEventListener("input",()=>{prospectPage=1;render()}));
if($("prospectView"))$("prospectView").addEventListener("change",()=>{prospectPage=1;render()});
if($("prospectPageSize"))$("prospectPageSize").addEventListener("change",()=>{prospectPage=1;render()});
if($("prospectPagination"))$("prospectPagination").onclick=e=>{const b=e.target.closest("[data-page]");if(!b)return;const total=prospectTotalPages;const target=b.dataset.page==="prev"?prospectPage-1:b.dataset.page==="next"?prospectPage+1:Number(b.dataset.page);if(target>=1&&target<=total){prospectPage=target;render();$("prospectsPanel").scrollIntoView({behavior:"smooth",block:"start"})}};
$("signalChips").onclick=e=>{const b=e.target.closest("[data-signal]");if(b){$("signalFilter").value=b.dataset.signal;prospectPage=1;render()}};
$("dashboardTerrain").onclick=e=>{
 const b=e.target.closest("[data-dashboard-action]"),city=e.target.closest("[data-dashboard-city]");
 if(city){$("city").value=city.dataset.dashboardCity;prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});return}
 if(!b)return;
 const action=b.dataset.dashboardAction;
 if(action==="priority"){$("movementFilter").value="high";prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="recent"){$("signalFilter").value="new";prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="follow"){$("signalFilter").value="follow";prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="changes"){$("signalFilter").value="priceDown";prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="address"){$("q").value="";$("city").value="";$("signalFilter").value="incomplete";prospectPage=1;render();$("list").scrollIntoView({behavior:"smooth",block:"start"});}
 else if(action==="tour"){$("ct-annonces-panel")?.scrollIntoView({behavior:"smooth",block:"start"});}
};

$("list").onclick=e=>{const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(edit){const p=prospects.find(x=>x.id===edit.dataset.edit);if(p)openForm(p)}if(del&&confirm("Supprimer ce prospect ?")){prospects=prospects.filter(x=>x.id!==del.dataset.delete);save()}};

function parseCSV(text){const rows=[];let row=[],cell="",quote=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){cell+='"';i++;continue}if(c==='"'){quote=!quote;continue}if(c===","&&!quote){row.push(cell);cell="";continue}if((c==="\n"||c==="\r")&&!quote){if(c==="\r"&&n==="\n")i++;row.push(cell);if(row.some(x=>x.trim()!==""))rows.push(row);row=[];cell="";continue}cell+=c}row.push(cell);if(row.some(x=>x.trim()!==""))rows.push(row);if(!rows.length)return[];const headers=rows.shift().map(h=>norm(h).replace(/ /g,""));const aliases={adresse:"address",rue:"address",codepostal:"postalCode",cp:"postalCode",commune:"city",ville:"city",quartier:"district",type:"type",surface:"area",surfacehabitable:"area",terrain:"land",terrainm2:"land",pieces:"rooms",chambres:"bedrooms",prix:"price",dpe:"dpe",statut:"status",detection:"detectionDate",datedetection:"detectionDate",prochainerelance:"nextFollow",source:"source",identifiantsource:"externalId",sourceurl:"sourceUrl",lien:"sourceUrl",description:"description",signal:"description",notes:"notes"};return rows.map(r=>{const o={};headers.forEach((h,i)=>{const k=aliases[h]||h;if(k)o[k]=(r[i]||"").trim()});o.area=numCSV(o.area);o.land=numCSV(o.land);o.rooms=numCSV(o.rooms);o.bedrooms=numCSV(o.bedrooms);o.price=numCSV(o.price);return o}).filter(o=>o.address&&o.city)}
function numCSV(v){if(v===undefined||v==="")return 0;return Number(String(v).replace(/\s/g,"").replace(",","." ).replace(/€/g,""))||0}
function csvCell(v){const s=String(v??"");return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCSV(){const fields=["address","postalCode","city","district","type","area","land","rooms","bedrooms","price","dpe","status","detectionDate","nextFollow","source","externalId","sourceUrl","description","notes"],head=["adresse","codePostal","commune","quartier","type","surface","terrain","pieces","chambres","prix","dpe","statut","detection","prochaineRelance","source","identifiantSource","sourceUrl","description","notes"],lines=[head.join(",")];prospects.forEach(p=>lines.push(fields.map(k=>csvCell(p[k])).join(",")));const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="jml-prospection-export.csv";a.click();URL.revokeObjectURL(url)}
function previewImport(){const file=$("csvFile").files[0];if(!file)return;$("importPreview").textContent="Lecture du fichier…";const reader=new FileReader();reader.onload=()=>{try{pendingImport=parseCSV(reader.result);const existing=pendingImport.filter(x=>prospects.some(p=>dedupeKey(p)===dedupeKey(x))).length;$("importPreview").innerHTML="<strong>"+pendingImport.length+"</strong> ligne(s) valide(s) · <strong>"+existing+"</strong> déjà connue(s) · les doublons seront fusionnés.<br><span class='meta'>Colonnes reconnues : adresse, CP, commune, surface, terrain, pièces, prix, DPE, détection, statut, source…</span>";$("importConfirm").disabled=!pendingImport.length}catch(err){pendingImport=[];$("importPreview").textContent="CSV illisible ou vide.";$("importConfirm").disabled=true}};reader.readAsText(file,"UTF-8")}
$("importBtn").onclick=()=>{$("csvFile").value="";$("importPreview").textContent="Choisis un fichier CSV." ;pendingImport=[];$("importConfirm").disabled=true;$("importDialog").showModal()};$("importClose").onclick=()=>$("importDialog").close();$("importCancel").onclick=()=>$("importDialog").close();$("csvFile").addEventListener("change",previewImport);$("importConfirm").onclick=()=>{let created=0,merged=0;pendingImport.forEach(x=>{const r=mergeProspect(x);r==="created"?created++:merged++});save();$("importDialog").close();alert("Import terminé : "+created+" nouveau(x), "+merged+" fusionné(s).");pendingImport=[]};$("exportBtn").onclick=exportCSV;

let futureRadarCandidates=[];
function futureRadarType(v=""){
  const s=String(v).toLowerCase();
  if(s.includes("appartement"))return "Appartement";
  if(s.includes("maison"))return "Maison";
  return "Autre";
}
function futureRadarRender(){
  const box=$("futureRadarResults"),add=$("futureRadarAddAll");
  if(!box)return;
  const toggle=$("futureRadarToggle");
  if(!futureRadarCandidates.length){
    box.innerHTML='<div class="meta">Aucun candidat exploitable trouvé pour cette analyse.</div>';
    if(add)add.disabled=true;
    if(toggle){toggle.disabled=true;toggle.setAttribute("aria-expanded","false");toggle.textContent="▸ Afficher les biens détectés";box.hidden=true;}
    return;
  }
  box.innerHTML=futureRadarCandidates.slice(0,100).map((p,i)=>{
    const ms=p.methodScores||{},ev=p.evidence||{},quality=ev.dataQuality||p.dataQuality||{};
    const sale=p.sameAddressSale||{};
    const dpeConfirmed=p.dpeConfirmed===true;
    const commercialScore=Number(p.commercialSignalScore||0);
    const commercialLevel=p.commercialSignalLevel||"Aucun signal commercial public";
    const commercialSignals=Array.isArray(p.commercialSignals)?p.commercialSignals:[];
    const dpeText=dpeConfirmed?"🟢 DPE "+(p.dpe||"—")+" confirmé à la même adresse":p.dpeAddressStatus==="uncertain"?"🟠 DPE trouvé · unité non confirmée":"⚪ DPE non confirmé";
    const saleText=sale.status==="confirmed"?"🟢 Vente DVF à la même adresse · "+sale.count+" mutation(s) · dernière "+(sale.latest?.date?new Date(sale.latest.date).toLocaleDateString("fr-FR"):"—")+" · "+(sale.ageYears!=null?Math.round(sale.ageYears)+" an(s)":"—"):sale.status==="ambiguous"?"🟠 Adresse exacte mais unité ambiguë · vente non confirmée":"⚪ Aucune vente DVF confirmée à la même adresse";
    const compText=(p.comparableCount||0)>0?"🔵 Comparables DVF distincts à proximité · "+p.comparableCount+" · médiane "+(p.comparableMedianDistance!=null?Math.round(p.comparableMedianDistance)+" m":"—")+" · "+(p.comparableDistanceStatus||((p.comparableRadius!=null)?"rayon "+p.comparableRadius+" m":"distance non disponible")):"⚪ Aucun comparable DVF distinct suffisamment proche";
    const terrainText=p.terrainArea?"🌳 Terrain documenté : "+Math.round(p.terrainArea)+" m²":"🌳 Terrain non documenté";
    const reasons=(p.reasons||[]).filter(x=>!/^DPE |^Dernière vente|^Aucune vente|^Adresse DVF|^Comparables locaux|^Médiane locale|^Dispersion des prix/.test(String(x))).slice(0,4);
    return '<article class="future-candidate"><div class="future-candidate-main"><label class="future-check"><input type="checkbox" data-future-check="'+i+'" checked><span></span></label><div><strong>'+apiEsc(p.address||"Adresse non renseignée")+'</strong><div class="meta">'+apiEsc((p.postalCode?p.postalCode+" ":"")+(p.city||""))+" · "+apiEsc(futureRadarType(p.buildingType))+(p.area?" · "+p.area+" m²":"")+'</div><div class="future-reasons"><span class="dpe-match '+(dpeConfirmed?"confirmed":p.dpeAddressStatus==="uncertain"?"uncertain":"none")+'">'+apiEsc(dpeText)+'</span><span class="dpe-match '+(sale.status==="confirmed"?"confirmed":sale.status==="ambiguous"?"uncertain":"none")+'">'+apiEsc(saleText)+'</span><span>'+apiEsc(compText)+'</span><span>'+apiEsc(terrainText)+'</span></div><div class="future-reasons">'+reasons.map(x=>'<span>'+apiEsc(x)+'</span>').join("")+'</div><div class="meta"><strong>Priorité prospection</strong> '+(p.priorityScore??p.score??0)+'/100 · <strong>Contexte marché</strong> '+(p.marketContextScore??0)+'/100 · Qualité '+(quality.score||0)+'/5 · DPE '+(ms.dpe||0)+'% · vente '+(ms.saleAge||0)+'% · type/surface '+(ms.typeSurface||0)+'% · terrain '+(ms.terrain||0)+'% · proximité '+(ms.proximity||0)+'% · historique '+(ms.history||0)+'%</div><div class="commercial-signal-box '+(commercialScore>0?"has-signal":"no-signal")+'"><strong>Signal commercial public : '+commercialScore+'/100</strong><span>'+apiEsc(commercialLevel)+'</span>'+(commercialSignals.length?'<small>'+commercialSignals.map(x=>apiEsc(x.label)).join(" · ")+'</small>':'<small>Aucun signal public de mise en vente détecté. Ce candidat est uniquement à surveiller.</small>')+'</div></div></div><div class="future-score"><strong>'+(p.priorityScore??p.score??0)+'/100</strong><small>'+apiEsc(p.priorityLevel||"Priorité prospection")+'</small><em>Contexte marché : '+(p.marketContextScore??0)+'/100</em></div></article>';
  }).join("");
  add.disabled=false;
  if(toggle){toggle.disabled=false;toggle.setAttribute("aria-expanded","true");toggle.textContent="✕ Masquer les "+futureRadarCandidates.length+" biens détectés";box.hidden=false;}
}
async function runFutureRadar(){
  const selected=[...document.querySelectorAll("[data-radar-sector]:checked")].map(input=>{
    const row=input.closest("[data-radar-sector-row]");
    return {id:input.value,label:input.dataset.label||input.value,q:input.dataset.label||input.value,radiusKm:Number(row?.querySelector("[data-radar-radius]")?.value)||15};
  });
  const q=($("futureRadarQuery")?.value||$("publicQuery")?.value||"").trim();
  if(!selected.length&&!q){
    $("futureRadarStatus").textContent="Sélectionne au moins un secteur ou indique une commune.";
    $("futureRadarReady").textContent="⚠️ Zone manquante";
    return;
  }
  $("futureRadarBtn").disabled=true;
  if(selected.length){
    $("futureRadarStatus").textContent="Préparation de l'analyse par lots…";
    if($("futureRadarReady")) $("futureRadarReady").textContent="⏳ Analyse progressive…";
    try{
      const merged=new Map();
      const sectorStats=new Map(selected.map(s=>[s.id,{...s,candidateCount:0,communeCount:0}]));
      let offset=0,totalCommunes=0,processed=0,totalDvf=0,totalDpe=0,totalRawDpe=0,totalDuplicates=0,anyFallback=false,failed=[];
      let complete=false;
      const candidateKey=p=>[
        norm(p.address||""),norm(p.postalCode||""),norm(p.city||""),
        norm(p.buildingRef||""),norm(p.apartmentRef||""),Number(p.area)||0,Number(p.rooms)||0
      ].join("|");
      while(!complete){
        $("futureRadarStatus").textContent="Analyse progressive · "+processed+(totalCommunes?"/"+totalCommunes:"")+" commune(s)…";
        const data=await publicJson("/api/radar-zone?sectors="+encodeURIComponent(JSON.stringify(selected))+"&limit=100&years=5&perCommuneLimit=60&communeBatch=6&zoneMode=1&dvfMaxRows=2500&offset="+offset);
        totalCommunes=Number(data.totalCommuneCount)||totalCommunes;
        processed+=Number(data.communesAnalyzed)||0;
        totalDvf+=Number(data.dvfCount)||0;
        totalDpe+=Number(data.dpeCount)||0;
        totalRawDpe+=Number(data.dpeRawCount)||0;
        totalDuplicates+=Number(data.dpeDuplicateCount)||0;
        anyFallback=anyFallback||Boolean(data.dvfFallback);
        failed=failed.concat(data.failedCommunes||[]);
        (data.results||[]).forEach(p=>merged.set(candidateKey(p),p));
        (data.sectors||[]).forEach(s=>{
          const old=sectorStats.get(s.id);
          if(old){old.communeCount=Math.max(old.communeCount,Number(s.communeCount)||0);old.candidateCount+=Number(s.candidateCount)||0}
        });
        futureRadarCandidates=Array.from(merged.values()).sort((a,b)=>(Number(b.priorityScore??b.score)||0)-(Number(a.priorityScore??a.score)||0));
        futureRadarRender();
        complete=data.complete===true;
        offset=Number(data.nextOffset);
        if(!Number.isFinite(offset)||complete)break;
      }
      futureRadarCandidates=futureRadarCandidates.slice(0,100);
      const sectors=Array.from(sectorStats.values()).map(x=>apiEsc(x.label)+" <strong>"+x.radiusKm+" km</strong>").join(" · ");
      const dedupInfo=totalDuplicates>0?" · "+totalDuplicates+" doublon(s) DPE écarté(s)":"";
      const errorInfo=failed.length>0?" · "+failed.length+" commune(s) indisponible(s)":"";
      $("futureRadarStatus").innerHTML="<strong>Zone de prospection analysée</strong> · "+sectors+" · <strong>"+futureRadarCandidates.length+"</strong> biens affichés · "+processed+"/"+totalCommunes+" commune(s) analysée(s)"+dedupInfo+errorInfo+" · "+totalDvf+" transactions comparées. "+apiEsc(anyFallback?"DVF open-data utilisé en secours.":"DVF+ utilisé.");
      if($("futureRadarReady")) $("futureRadarReady").textContent="✅ Analyse terminée · "+processed+" commune(s) · "+futureRadarCandidates.length+" bien(s)";
      if($("publicQuery")) $("publicQuery").value=selected[0]?.label||"";
    }catch(e){
      $("futureRadarStatus").textContent="Erreur analyse de la zone : "+e.message;
      if($("futureRadarReady")) $("futureRadarReady").textContent="❌ Analyse interrompue · résultats partiels conservés";
      futureRadarRender();
    }finally{$("futureRadarBtn").disabled=false}
    return;
  }
  if($("publicQuery")) $("publicQuery").value=q;
  if($("futureRadarQuery")) $("futureRadarQuery").value=q;
  $("futureRadarStatus").textContent="Vérification de la commune puis lancement ADEME + DVF + radar…";
  if($("futureRadarReady")) $("futureRadarReady").textContent="⏳ Analyse en cours…";
  try{
    const commune=await publicJson("/api/commune?q="+encodeURIComponent(q));
    const resolved=commune?.[0]?.city||q;
    if($("futureRadarQuery")) $("futureRadarQuery").value=resolved;
    if($("publicQuery")) $("publicQuery").value=resolved;
    const [sourceResult,radarResult]=await Promise.allSettled([searchPublicSources(),publicJson("/api/radar?q="+encodeURIComponent(resolved)+"&limit=100&years=5")]);
    if(radarResult.status!=="fulfilled") throw radarResult.reason;
    const data=radarResult.value;
    futureRadarCandidates=data.results||[];
    futureRadarRender();
    const dedupInfo=Number(data.dpeDuplicateCount||0)>0?" · "+data.dpeDuplicateCount+" doublon(s) DPE écarté(s)":"";
    const sourceNote=sourceResult.status==="fulfilled"?" · Sources publiques synchronisées":" · Sources publiques non disponibles (radar conservé)";
    $("futureRadarStatus").innerHTML="<strong>"+apiEsc(resolved)+"</strong> · "+data.dpeCount+" DPE uniques analysés"+dedupInfo+" · "+data.dvfCount+" transactions comparées · "+futureRadarCandidates.length+" candidats classés. "+apiEsc(data.dvfFallback?"DVF open-data utilisé en secours.":"DVF+ utilisé.")+sourceNote;
    if($("futureRadarReady")) $("futureRadarReady").textContent="✅ Commune analysée : "+resolved;
  }catch(e){
    futureRadarCandidates=[];
    futureRadarRender();
    $("futureRadarStatus").textContent="Erreur analyse commune : "+e.message;
    if($("futureRadarReady")) $("futureRadarReady").textContent="❌ Analyse interrompue";
  }finally{$("futureRadarBtn").disabled=false}
}
function addFutureRadarCandidates(){
  const selected=[...document.querySelectorAll("[data-future-check]:checked")].map(x=>futureRadarCandidates[Number(x.dataset.futureCheck)]).filter(Boolean);
  let created=0,merged=0;
  for(const p of selected){
    const incoming={
      address:p.address||"",postalCode:p.postalCode||"",city:p.city||"",district:"",
      type:futureRadarType(p.buildingType),area:num(p.area),land:num(p.terrainArea||p.latestSale?.landArea),
      rooms:num(p.sameAddressSale?.latest?.rooms||p.latestSale?.rooms),bedrooms:0,price:0,dpe:p.dpe||"",
      futureRadarScore:num(p.priorityScore??p.score),marketContextScore:num(p.marketContextScore),commercialSignalScore:num(p.commercialSignalScore),dataQuality:p.dataQuality||null,status:"Pas encore en vente",
      detectionDate:today(),nextFollow:"",source:"Radar surveillance · ADEME + comparables DVF",
      externalId:p.id||"",sourceUrl:"https://data.ademe.fr/datasets/dpe03existant",
      description:"Priorité prospection : "+num(p.priorityScore??p.score)+"/100. Contexte marché : "+num(p.marketContextScore)+"/100. Signal commercial public : "+num(p.commercialSignalScore)+"/100 — "+(p.commercialSignalLevel||"Aucun signal commercial public")+". "+(p.commercialSignals||[]).map(x=>x.label).join(" · "),
      notes:"Ce bien est une cible de surveillance et non un prospect vendeur confirmé. DPE même adresse = "+(p.dpeConfirmed?"confirmé":"non confirmé")+" ; vente DVF même adresse = "+(p.sameAddressSaleConfirmed?"confirmée":"non confirmée")+" ; comparables distincts = "+(p.comparableCount||0)+". "+(p.disclaimer||"")
    };
    const result=mergeProspect(incoming);
    result==="created"?created++:merged++;
  }
  if(selected.length){save();alert("Surveillance : "+created+" bien(s) ajouté(s), "+merged+" déjà présent(s) fusionné(s).")}
}
$("futureRadarBtn").onclick=runFutureRadar;
$("futureRadarAddAll").onclick=addFutureRadarCandidates;
let publicDpeResults=[],publicDvfResults=[];
function apiEsc(v=""){return esc(v)}
async function publicJson(url){let r;try{r=await fetch(url,{cache:"no-store"});}catch(e){throw new Error("Connexion au serveur JML impossible : "+(e.message||"fetch failed"))}let d;try{d=await r.json()}catch(e){throw new Error("Réponse serveur invalide (HTTP "+r.status+")")}if(!r.ok)throw new Error(d.error||("Erreur serveur HTTP "+r.status));return d}
function publicDpeKey(p){
  return [norm(p.address),norm(p.postalCode),norm(p.city)].join("|");
}
function groupPublicDpe(rows){
  const groups=new Map();
  for(const p of (rows||[])){
    const key=publicDpeKey(p)||("unknown|"+(p.dpeNumber||Math.random()));
    if(!groups.has(key))groups.set(key,{primary:p,items:[],grades:new Set(),areas:new Set(),types:new Set(),dates:[]});
    const g=groups.get(key);
    g.items.push(p);
    if(p.dpe)g.grades.add(String(p.dpe));
    if(Number(p.area)>0)g.areas.add(Number(p.area));
    if(p.buildingType)g.types.add(String(p.buildingType));
    if(p.date)g.dates.push(String(p.date));
  }
  return Array.from(groups.values()).map(g=>({
    ...g.primary,
    groupedCount:g.items.length,
    groupedGrades:[...g.grades].sort(),
    groupedAreas:[...g.areas].sort((a,b)=>a-b),
    groupedTypes:[...g.types],
    latestDpeDate:g.dates.sort().at(-1)||g.primary.date||"",
    groupedDpeNumbers:g.items.map(x=>x.dpeNumber).filter(Boolean)
  })).sort((a,b)=>String(b.latestDpeDate||"").localeCompare(String(a.latestDpeDate||"")));
}
function groupPublicDvf(rows){
  const groups=new Map();
  for(const p of (rows||[])){
    const mutation=String(p.mutationId||"").trim();
    const address=norm(p.address||"");
    const value=Number(p.value)||0;
    const key=mutation
      ? "mutation|"+mutation+"|"+address
      : "fallback|"+String(p.date||"")+"|"+address+"|"+value;
    if(!groups.has(key))groups.set(key,{...p,groupedCount:0,groupedTypes:new Set(),groupedBuiltAreas:new Set(),groupedLandAreas:new Set(),groupedRooms:new Set()});
    const g=groups.get(key);
    g.groupedCount++;
    if(p.type)g.groupedTypes.add(String(p.type));
    if(Number(p.builtArea)>0)g.groupedBuiltAreas.add(Number(p.builtArea));
    if(Number(p.landArea)>0)g.groupedLandAreas.add(Number(p.landArea));
    if(Number(p.rooms)>0)g.groupedRooms.add(Number(p.rooms));
  }
  return Array.from(groups.values()).map(g=>({
    ...g,
    groupedTypes:[...g.groupedTypes],
    groupedBuiltAreas:[...g.groupedBuiltAreas].sort((a,b)=>a-b),
    groupedLandAreas:[...g.groupedLandAreas].sort((a,b)=>a-b),
    groupedRooms:[...g.groupedRooms].sort((a,b)=>a-b)
  }));
}
function renderPublicDpe(rows){
  publicDpeResults=groupPublicDpe(rows);
  $("publicDpeResults").innerHTML=publicDpeResults.length?publicDpeResults.slice(0,30).map((p,i)=>{
    const areas=p.groupedAreas?.length?p.groupedAreas.map(x=>x+" m²").join(" / "):(p.area?p.area+" m²":"");
    const grades=p.groupedGrades?.length?"DPE "+p.groupedGrades.join(" / "):"DPE —";
    const types=p.groupedTypes?.length?p.groupedTypes.join(" / "):"";
    const units=p.groupedCount>1?" · "+p.groupedCount+" DPE/logements regroupés":"";
    return '<article class="source-result"><div><strong>'+apiEsc(p.address||"Adresse non renseignée")+'</strong><span>'+apiEsc((p.postalCode?p.postalCode+" ":"")+(p.city||""))+'</span></div><div class="source-result-details">'+areas+(areas?" · ":"")+grades+(p.ges?" · GES "+apiEsc(p.ges):"")+(types?" · "+apiEsc(types):"")+apiEsc(units)+'</div><div class="meta">'+(p.latestDpeDate?"DPE le plus récent : "+apiEsc(p.latestDpeDate):"Date DPE inconnue")+'</div><button class="ghost" data-dpe-index="'+i+'">Préparer une fiche</button></article>';
  }).join(""):'<div class="meta">Aucun DPE trouvé pour cette recherche.</div>';
}
function renderPublicDvf(rows){
  publicDvfResults=groupPublicDvf(rows);
  $("publicDvfResults").innerHTML=publicDvfResults.length?publicDvfResults.slice(0,30).map(p=>{
    const types=p.groupedTypes?.length?p.groupedTypes.join(" / "):(p.type||"Bien immobilier");
    const areas=p.groupedBuiltAreas?.length?p.groupedBuiltAreas.map(x=>x+" m² bâti").join(" / "):(p.builtArea?p.builtArea+" m² bâti":"");
    const lands=p.groupedLandAreas?.length?p.groupedLandAreas.map(x=>x+" m² terrain").join(" / "):(p.landArea?p.landArea+" m² terrain":"");
    const rooms=p.groupedRooms?.length?" · "+p.groupedRooms.join(" / ")+" pièce(s)":"";
    const grouped=p.groupedCount>1?" · "+p.groupedCount+" éléments regroupés":"";
    return '<article class="source-result"><div><strong>'+apiEsc(p.date||"Date inconnue")+'</strong><span>'+apiEsc(types)+'</span></div><div class="source-result-details">'+(p.value?p.value.toLocaleString("fr-FR")+" € · ":"")+areas+(areas&&lands?" · ":"")+lands+rooms+apiEsc(grouped)+'</div><div class="meta">'+(p.address?apiEsc(p.address)+" · ":"")+"Source : "+apiEsc(p.source||"DVF open-data")+" · "+apiEsc(p.cityCode||"")+'</div></article>';
  }).join(""):'<div class="meta">Aucune transaction trouvée.</div>';
}
function publicSourceQueryMode(q){
  return /\\d/.test(String(q||"")) ? "adresse" : "commune";
}
async function searchPublicSources(){
  const q=$("publicQuery").value.trim();
  if(!q){$("publicStatus").textContent="Indique une commune ou une adresse.";return}
  $("publicStatus").textContent="Recherche ADEME + DVF+ en cours…";
  $("publicSearchBtn").disabled=true;
  try{
    const known={
      "charleville mezieres":{city:"Charleville-Mézières",cityCode:"08105"},
      "sedan":{city:"Sedan",cityCode:"08409"},
      "rethel":{city:"Rethel",cityCode:"08362"},
      "revin":{city:"Revin",cityCode:"08363"},
      "givet":{city:"Givet",cityCode:"08190"},
      "vouziers":{city:"Vouziers",cityCode:"08490"}
    };
    const key=String(q).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    let c=known[key];
    if(!c){
      const communes=await publicJson("/api/commune?q="+encodeURIComponent(q));
      c=communes[0];
    }
    if(!c)throw new Error("Commune introuvable");
    const mode=publicSourceQueryMode(q);
    const params="codeInsee="+encodeURIComponent(c.cityCode);
    const dpeUrl=mode==="adresse"
      ? "/api/dpe?q="+encodeURIComponent(q)+"&limit=100"
      : "/api/dpe?"+params+"&limit=100";
    const dvfUrl="/api/dvf?"+params+"&limit=100&yearMin="+(new Date().getFullYear()-5)+(mode==="adresse"?"&address="+encodeURIComponent(q):"");
    const [dpeResult,dvfResult]=await Promise.allSettled([
      publicJson(dpeUrl),
      publicJson(dvfUrl)
    ]);
    const dpe=dpeResult.status==="fulfilled"?dpeResult.value:null;
    const dvf=dvfResult.status==="fulfilled"?dvfResult.value:null;
    const dvfError=dvfResult.status==="rejected"?String(dvfResult.reason?.message||"erreur source DVF+"):"";
    renderPublicDpe(dpe?.results||[]);
    renderPublicDvf(dvf?.results||[]);
    const modeText=mode==="adresse"?"🎯 Recherche ciblée sur l’adresse":"🗺️ Recherche communale";
    const dpeText=dpe?((dpe.rawCount??dpe.results?.length??0)+" DPE bruts · "+groupPublicDpe(dpe.results||[]).length+" adresses DPE"): "ADEME indisponible";
    const dvfText=dvf
      ? ((dvf.groupedCount!=null?dvf.groupedCount:groupPublicDvf(dvf.results||[]).length)+" opérations uniques"+(mode==="adresse"?" à cette adresse":"")+" · "+(dvf.filteredCount!=null?dvf.filteredCount:(dvf.rawCount??dvf.results?.length??0))+" lignes brutes · "+String(dvf.source||"DVF open-data")+(dvf.fallback?" · secours":""))
      : "DVF indisponible ("+apiEsc(dvfError)+")";
    $("publicStatus").innerHTML="<strong>"+apiEsc(c.city)+"</strong> · code INSEE "+apiEsc(c.cityCode)+" · "+modeText+" · "+dpeText+" · "+dvfText;
  }catch(e){
    $("publicStatus").textContent="Erreur : "+e.message;
    renderPublicDpe([]);renderPublicDvf([]);
  }finally{$("publicSearchBtn").disabled=false}
}
$("publicSearchBtn").onclick=searchPublicSources;
$("publicQuery").addEventListener("keydown",e=>{if(e.key==="Enter")searchPublicSources()});
async function runDataAgent(){
  const q=$("publicQuery").value.trim();
  if(!q){$("dataAgentStatus").textContent="Indique d'abord une commune.";return}
  $("dataAgentStatus").textContent="Contrôle qualité ADEME + DVF en cours…";
  $("dataAgentBtn").disabled=true;
  try{
    const d=await publicJson("/api/data-agent?q="+encodeURIComponent(q)+"&limit=100");
    $("dataAgentQuality").textContent=d.qualityScore+"/100 · "+d.qualityLevel;
    $("dataAgentStatus").textContent=d.dpeCount+" DPE · "+d.dvfCount+" mutations · "+d.dvfSource+(d.dvfFallback?" · secours activé":"");
    $("dataAgentRejected").innerHTML=d.rejected.length?d.rejected.slice(0,10).map(x=>"<div><strong>"+apiEsc(x.source)+"</strong> · "+apiEsc(x.level)+" · "+apiEsc((x.issues||[]).concat(x.warnings||[]).join(" · "))+"</div>").join(""):"Aucune donnée rejetée dans l'échantillon.";
    $("dataAgentConflicts").innerHTML=d.conflicts.length?d.conflicts.slice(0,10).map(x=>"<div><strong>Conflit</strong> · "+apiEsc(x.reason)+"</div>").join(""):"Aucun conflit majeur détecté.";
  }catch(e){
    $("dataAgentQuality").textContent="—";
    $("dataAgentStatus").textContent="Erreur : "+e.message;
    $("dataAgentRejected").textContent="";
    $("dataAgentConflicts").textContent="";
  }finally{$("dataAgentBtn").disabled=false}
}
$("dataAgentBtn").onclick=runDataAgent;

publicJson("/api/health").then(()=>{$("sourceApiStatus").textContent="Connectées"}).catch(()=>{$("sourceApiStatus").textContent="Serveur indisponible"});
$("publicDpeResults").onclick=e=>{
  const b=e.target.closest("[data-dpe-index]");if(!b)return;
  const p=publicDpeResults[Number(b.dataset.dpeIndex)];if(!p)return;
  openForm({address:p.address||"",postalCode:p.postalCode||"",city:p.city||"",type:"Maison",area:p.area||0,land:0,rooms:0,bedrooms:0,price:0,dpe:p.dpe||"",status:"Nouveau",detectionDate:today(),nextFollow:"",source:"DPE ADEME",externalId:p.dpeNumber||"",sourceUrl:"https://data.ademe.fr/datasets/dpe03existant",description:"Donnée technique publique DPE ADEME. À vérifier sur le terrain avant toute qualification commerciale.",notes:"DPE : "+(p.dpe||"—")+" · GES : "+(p.ges||"—")+" · Date : "+(p.date||"—")});
};
prospects.forEach(ensureHistory);render();initCollapsiblePanels();initRadarCommuneInput();initRadarTerritory();
/* V1.13.0 — prospection annonce publique + carte + rapprochement DVF/DPE */
let privateProspectMap=null;
let privateProspectLayers=null;
let privateProspectMatch=null;

function initPrivateProspectMap(){
  if(!window.L||privateProspectMap)return;
  privateProspectMap=L.map("privateProspectMap",{scrollWheelZoom:true});
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap contributors"}).addTo(privateProspectMap);
  privateProspectLayers=L.layerGroup().addTo(privateProspectMap);
  privateProspectMap.setView([49.77,4.72],11);
}

function privateMapPopup(title,body){
  return "<strong>"+apiEsc(title||"Point")+"</strong><br>"+apiEsc(body||"");
}

function renderPrivateProspectMap(data){
  initPrivateProspectMap();
  if(!privateProspectMap||!privateProspectLayers)return;
  privateProspectLayers.clearLayers();
  const bounds=[];
  const g=data?.geocode;
  if(g?.latitude&&g?.longitude){
    const marker=L.marker([g.latitude,g.longitude]).bindPopup(privateMapPopup("Annonce publique",g.label||data.property?.address||"Adresse"));
    marker.addTo(privateProspectLayers);bounds.push([g.latitude,g.longitude]);
  }
  for(const tx of (data?.dvf?.transactions||[])){
    if(!tx.latitude||!tx.longitude)continue;
    const m=L.circleMarker([tx.latitude,tx.longitude],{radius:6,weight:2,fillOpacity:.65})
      .bindPopup(privateMapPopup("DVF · "+(tx.date||"date inconnue"),[(tx.value||0).toLocaleString("fr-FR")+" €",tx.builtArea?tx.builtArea+" m² bâti":"",tx.distanceMeters!=null?Math.round(tx.distanceMeters)+" m":"",tx.address||""].filter(Boolean).join(" · ")));
    m.addTo(privateProspectLayers);bounds.push([tx.latitude,tx.longitude]);
  }
  for(const dpe of (data?.dpe?.candidates||[])){
    if(!dpe.latitude||!dpe.longitude)continue;
    const m=L.circleMarker([dpe.latitude,dpe.longitude],{radius:5,weight:2,fillOpacity:.55})
      .bindPopup(privateMapPopup("DPE "+(dpe.dpe||"—"),(dpe.address||"Adresse DPE")+(dpe.dpeAddressStatus==="confirmed"?" · même adresse":" · correspondance incertaine")));
    m.addTo(privateProspectLayers);bounds.push([dpe.latitude,dpe.longitude]);
  }
  if(bounds.length)privateProspectMap.fitBounds(bounds,{padding:[25,25],maxZoom:17});
  setTimeout(()=>privateProspectMap.invalidateSize(),80);
}

function privateMatchStatusLabel(data){
  const d=data?.dpe?.status;
  const v=data?.dvf?.status;
  const dpeLabel=d==="confirmed"?"🟢 DPE confirmé à la même adresse":d==="uncertain"?"🟠 DPE trouvé · correspondance incertaine":"⚪ Aucun DPE correspondant";
  const dvfLabel=v==="exact"?"🟢 DVF adresse exacte":v==="street"?"🟠 DVF même rue":v==="proximity"?"🟠 DVF proximité":"⚪ Pas de correspondance DVF fiable";
  return dpeLabel+" · "+dvfLabel;
}

function renderPrivateProspectResult(data){
  privateProspectMatch=data;
  renderPrivateProspectMap(data);
  const d=data.dpe||{},v=data.dvf||{},c=data.comparables||{};
  const dpeHtml=(d.candidates||[]).slice(0,6).map(x=>'<div class="match-line"><strong>DPE '+apiEsc(x.dpe||"—")+'</strong><span>'+apiEsc(x.address||"Adresse inconnue")+'</span><em>'+apiEsc(x.dpeAddressStatus==="confirmed"?"Même adresse":"Correspondance incertaine")+'</em></div>').join("")||'<div class="meta">Aucun DPE rapproché.</div>';
  const dvfHtml=(v.transactions||[]).slice(0,8).map(x=>'<div class="match-line"><strong>'+((x.value||0).toLocaleString("fr-FR"))+' €</strong><span>'+apiEsc(x.date||"Date inconnue")+' · '+apiEsc(x.type||"")+(x.builtArea?" · "+x.builtArea+" m²":"")+'</span><em>'+(x.distanceMeters!=null?Math.round(x.distanceMeters)+" m":"adresse")+'</em></div>').join("")||'<div class="meta">Aucune mutation rapprochée.</div>';
  $("privateMatchResults").innerHTML='<div class="private-result-head"><strong>'+apiEsc(data.property?.address||"Adresse")+'</strong><span>'+apiEsc((data.property?.postalCode||"")+" "+(data.property?.city||""))+'</span></div><div class="private-status-badges"><span>'+apiEsc(privateMatchStatusLabel(data))+'</span></div><div class="private-kpis"><article><strong>'+((d.confirmedCount||0))+'</strong><span>DPE même adresse</span></article><article><strong>'+((v.matchedCount||0))+'</strong><span>DVF à l’adresse</span></article><article><strong>'+((c.count||0))+'</strong><span>Comparables</span></article><article><strong>'+((c.medianPriceM2||0)?Math.round(c.medianPriceM2).toLocaleString("fr-FR")+" €":"—")+'</strong><span>Médiane €/m²</span></article></div><div class="match-columns"><div><h3>DPE</h3>'+dpeHtml+'</div><div><h3>DVF</h3>'+dvfHtml+'</div></div><div class="private-score-note">Rapprochement DVF : '+apiEsc(v.reason||"—")+' · Source : '+apiEsc(v.source||"—")+'</div>';
  $("privateAddBtn").disabled=false;
}

async function runPrivateProspectMatch(){
  const address=$("privateAddress").value.trim();
  if(!address){$("privateMatchStatus").textContent="Indique l'adresse de l'annonce.";return}
  $("privateMatchBtn").disabled=true;
  $("privateAddBtn").disabled=true;
  $("privateMatchStatus").textContent="Géocodage BAN + recherche DVF jusqu'à 10 000 transactions + rapprochement DPE…";
  try{
    const params=new URLSearchParams({
      address,
      postalCode:$("privatePostalCode").value.trim(),
      city:$("privateCity").value.trim(),
      type:$("privateType").value,
      area:$("privateArea").value||0,
      rooms:$("privateRooms").value||0,
      price:$("privatePrice").value||0
    });
    const data=await publicJson("/api/prospect-match?"+params.toString());
    renderPrivateProspectResult(data);
    $("privateMatchStatus").innerHTML="<strong>"+apiEsc(data.geocode?.label||address)+"</strong> · "+apiEsc(privateMatchStatusLabel(data))+" · "+apiEsc(data.disclaimer||"");
  }catch(e){
    privateProspectMatch=null;
    $("privateMatchResults").innerHTML="";
    $("privateMatchStatus").textContent="Erreur : "+e.message;
  }finally{$("privateMatchBtn").disabled=false}
}

function addPrivateProspectToCrm(){
  const d=privateProspectMatch;
  if(!d)return;
  const source=$("privateSource").value.trim()||"Annonce particulier publique";
  const listingUrl=$("privateListingUrl").value.trim();
  const p=d.property||{};
  const dpe=d.dpe?.candidates?.find(x=>x.dpeAddressStatus==="confirmed")||d.dpe?.candidates?.[0];
  openForm({
    address:p.address||$("privateAddress").value.trim(),
    postalCode:p.postalCode||$("privatePostalCode").value.trim(),
    city:p.city||$("privateCity").value.trim(),
    type:p.buildingType||"Maison",
    area:p.area||0,
    land:0,
    rooms:p.rooms||0,
    bedrooms:0,
    price:p.price||0,
    dpe:dpe?.dpe||"",
    status:"Nouveau",
    detectionDate:today(),
    nextFollow:"",
    source,
    externalId:"",
    sourceUrl:listingUrl,
    description:"Annonce publique fournie par l'utilisateur · "+(d.geocode?.label||p.address||"")+".",
    notes:"Croisement JML : "+privateMatchStatusLabel(d)+". DVF : "+(d.dvf?.matchedCount||0)+" mutation(s) rapprochée(s). DPE confirmé : "+(d.dpe?.confirmedCount||0)+". Médiane comparables : "+(d.comparables?.medianPriceM2?Math.round(d.comparables.medianPriceM2)+" €/m²":"—")+"."
  });
}

if($("privateMatchBtn")){
  initPrivateProspectMap();
  $("privateMatchBtn").onclick=runPrivateProspectMatch;
  $("privateAddBtn").onclick=addPrivateProspectToCrm;
  window.addEventListener("resize",()=>{if(privateProspectMap)privateProspectMap.invalidateSize()});
}

/* V1.16.0 — connecteur gratuit ChercherTrouver uniquement */
function renderIntegrationHealth(data){
  const ct=data?.chercherTrouver||{};
  const ctOk=ct.ok===true;
  $("chercherTrouverStatus").textContent=ctOk?"🟢 CONNECTÉ":"🔴 ERREUR";
  $("chercherTrouverDetails").textContent=ctOk
    ? "Offre "+(ct.tier||"—")+" · "+(ct.itemsPerDay||"—")+" annonces/jour · ping sans quota."
    : (ct.error||"Clé absente ou invalide.");
  $("integrationsStatus").textContent=ctOk
    ?"ChercherTrouver répond correctement côté serveur, sans appel payant."
    :"La connexion ChercherTrouver nécessite une vérification dans Render.";
}
async function testIntegrations(){
  $("integrationsTestBtn").disabled=true;
  $("integrationsStatus").textContent="Test ChercherTrouver en cours…";
  try{ renderIntegrationHealth(await publicJson("/api/integrations-health")); }
  catch(e){
    $("integrationsStatus").textContent=e.message.includes("HTTP 404")
      ?"Serveur JML non synchronisé avec cette version : redéploiement Render nécessaire."
      :"Erreur de test : "+e.message;
    $("chercherTrouverStatus").textContent="—";
  }
  finally{$("integrationsTestBtn").disabled=false}
}
if($("integrationsTestBtn")) $("integrationsTestBtn").onclick=testIntegrations;


/* V1.19.6 — concordance adresse renforcée */
let ctAnnonces=[];
function ctEuro(v){const n=Number(v);return n>0?n.toLocaleString("fr-FR")+" €":"—"}
function ctAnnonceType(v){return String(v||"Autre").trim()||"Autre"}
function ctRender(items){
  ctAnnonces=Array.isArray(items)?items:[];
  const box=$("ctResults"),add=$("ctAddBtn");
  if(!box)return;
  add.disabled=!ctAnnonces.length;if($("ctLocateBtn"))$("ctLocateBtn").disabled=!ctAnnonces.length;
  if(!ctAnnonces.length){box.innerHTML='<div class="meta">Aucune annonce trouvée avec ces critères.</div>';return}
  box.innerHTML=ctAnnonces.map((p,i)=>{
    const price=ctEuro(p.price),surface=p.surface?Number(p.surface).toLocaleString("fr-FR")+" m²":"Surface —";
    const m2=p.price_per_m2?Math.round(Number(p.price_per_m2)).toLocaleString("fr-FR")+" €/m²":"€/m² —";
    const loc=[p.postal_code,p.city].filter(Boolean).join(" ");
    const dpe=p.dpe?"DPE "+p.dpe:"DPE —";
    const seller=p.seller_type?" · "+p.seller_type:"";
    const portals=Array.isArray(p.sources)?p.sources.filter(x=>x&&x.source).map(x=>x.source).filter((v,j,a)=>a.indexOf(v)===j):[];
    const portalHtml=portals.length?'<div class="meta">Autres portails du même bien : <strong>'+apiEsc(portals.join(" · "))+'</strong></div>':"";
    const sourceHtml='<div class="meta">📡 Catalogue : <strong>ChercherTrouver.immo</strong> · Source annonce : <strong>'+apiEsc(p.source||"Non précisée")+'</strong></div>';
    return '<article class="ct-card"><div class="ct-card-head"><input type="checkbox" data-ct-check="'+i+'" checked><div><h3>'+apiEsc(p.title||ctAnnonceType(p.type)+" à "+(p.city||""))+'</h3><div class="meta">'+apiEsc(loc)+seller+'</div><div class="ct-price">'+price+'</div><div class="meta">'+surface+" · "+m2+" · "+(p.rooms?p.rooms+" pièce(s) · ":"")+apiEsc(dpe)+'</div><div class="ct-badges"><span>'+apiEsc(p.source||"ChercherTrouver")+'</span>'+(portals.length>1?'<span>'+portals.length+" portails"+'</span>':"")+(p.exclusive?'<span>Exclusivité</span>':"")+(p.price_history?.previous?'<span>Baisse suivie</span>':"")+'</div>'+sourceHtml+portalHtml+(p.external_url?'<a href="'+apiEsc(p.external_url)+'" target="_blank" rel="noopener">Voir l’annonce publique ↗</a>':"")+'<div class="ct-card-actions"><button class="ghost ct-address-btn" data-ct-address="'+i+'">📍 Chercher l’adresse gratuitement</button></div><div id="ct-address-result-'+i+'" class="ct-address-result"></div></div></div></article>'
  }).join("");
}
function ctDistanceKm(lat1,lon1,lat2,lon2){
  const R=6371,rad=Math.PI/180;
  const dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
let ctTourAnnonces=[];
async function ctSectorTour(){
  const btn=$("ctTourBtn"),box=$("ctTourResult");
  if(!btn||!box)return;
  btn.disabled=true; box.innerHTML='<div class="meta">Recherche du secteur le plus compact…</div>';
  try{
    const dept=$("ctDept").value.trim()||"08",type=$("ctType").value||"";
    const data=await publicJson("/api/sector-tour?"+new URLSearchParams({dept,type,min:"10",maxRadius:"20"}));
    ctTourAnnonces=data.items||[];
    const inCrm=p=>prospects.some(x=>{
      const a=norm(x.externalId||""),b=norm(p.reference||"");
      if(a&&b&&a===b)return true;
      return x.sourceUrl&&p.external_url&&String(x.sourceUrl)===String(p.external_url);
    });
    const fresh=ctTourAnnonces.filter(p=>!inCrm(p)).length;
    const cards=ctTourAnnonces.map((p,i)=>'<div class="ct-tour-item"><strong>'+apiEsc(p.title||"Bien à vendre")+'</strong><span>'+apiEsc([p.postal_code,p.city].filter(Boolean).join(" · "))+' · '+(p.distanceKm!=null?p.distanceKm+" km du centre du secteur":"")+'</span><span>'+apiEsc([p.price?Number(p.price).toLocaleString("fr-FR")+" €":"",p.surface?p.surface+" m²":"",p.rooms?p.rooms+" pièces":"",p.dpe?"DPE "+p.dpe:""].filter(Boolean).join(" · "))+'</span><small>'+apiEsc(p.source||"Source publique")+(inCrm(p)?" · ⚪ déjà dans CRM":" · 🔥 hors CRM")+'</small>'+(p.external_url?'<a href="'+apiEsc(p.external_url)+'" target="_blank" rel="noopener">Voir l’annonce</a>':"")+'</div>').join("");
    const sector=data.sector?.center?.city||"secteur détecté";
    box.innerHTML='<div class="ct-tour-head"><div><strong>🎯 Tournée '+(data.enough?"prête":"incomplète")+' · '+data.found+'/10</strong><span>'+apiEsc(sector)+' · distance moyenne '+(data.sector?.averageDistanceKm??"—")+' km · max '+(data.sector?.maxDistanceKm??"—")+' km</span></div><button id="ctTourAddBtn" class="primary" '+(data.found?"":"disabled")+'>+ Ajouter la tournée au CRM</button></div>'+(data.warning?'<div class="ct-tour-warning">⚠️ '+apiEsc(data.warning)+'</div>':"")+'<div class="ct-tour-summary">🔥 '+fresh+' annonce(s) absente(s) du CRM · '+data.search.private+' particulier(s) reçue(s) · '+data.search.received+' annonce(s) API reçue(s)</div><div class="ct-tour-grid">'+cards+'</div>';
    const add=$("ctTourAddBtn"); if(add)add.onclick=()=>{
      let created=0,merged=0;
      for(const p of ctTourAnnonces){
        const incoming={address:"",postalCode:p.postal_code||"",city:p.city||"",district:"",type:ctAnnonceType(p.type),area:num(p.surface),land:num(p.land_surface),rooms:num(p.rooms),bedrooms:num(p.bedrooms),price:num(p.price),dpe:p.dpe||"",detectionDate:today(),nextFollow:"",source:"ChercherTrouver · "+(p.source||"catalogue"),externalId:p.reference||"",sourceUrl:p.external_url||"",description:p.description||p.title||"",notes:"Tournée sectorielle · annonce publique. Ne pas utiliser cette fiche pour identifier un propriétaire.",status:"Nouveau",publicListingActive:true,publicPriceDrop:Boolean(p.price_history?.previous&&Number(p.price_history.previous)>Number(p.price||0)),publicListingReappeared:false};
        const result=mergeProspect(incoming);result==="created"?created++:merged++;
      }
      save();alert("Tournée : "+created+" ajoutée(s), "+merged+" déjà présente(s) fusionnée(s).");
    };
  }catch(e){box.innerHTML='<div class="meta">Erreur préparation tournée : '+apiEsc(e.message)+'</div>'}
  finally{btn.disabled=false}
}
async function ctSearch(){
  const btn=$("ctSearchBtn");btn.disabled=true;$("ctStatus").textContent="Recherche ChercherTrouver en cours…";
  try{
    const qs=new URLSearchParams();
    const dept=$( "ctDept").value.trim(),ville=$( "ctVille").value.trim(),type=$( "ctType").value,prix=$( "ctPrixMax").value,surface=$( "ctSurfaceMin").value,dpe=$( "ctDpe").value,radius=Number($( "ctRadius")?.value)||0;
    qs.set("transaction","vente");qs.set("sort","recent");qs.set("page_size","100");qs.set("dedup","0");
    if(dept)qs.set("dept",dept);
    if(radius<=0&&ville)qs.set("ville",ville);
    if(type)qs.set("type",type);if(prix)qs.set("prix_max",prix);if(surface)qs.set("surface_min",surface);if(dpe)qs.set("dpe",dpe);
    const freshDays=Number($( "ctFresh")?.value)||0;
    if(freshDays>0)qs.set("created_since",new Date(Date.now()-freshDays*86400000).toISOString());
    const data=await publicJson("/api/annonces?"+qs.toString());
    let raw=Array.isArray(data.items)?data.items:[];
    let center=null;
    if(ville&&radius>0){
      const geo=await publicJson("/api/geocode?q="+encodeURIComponent(ville));
      center=geo?.results?.[0]||null;
      if(!center?.latitude||!center?.longitude)throw new Error("Impossible de géocoder la commune pour appliquer le rayon.");
      raw=raw.map(p=>{
        const lat=Number(p.latitude??p.lat),lon=Number(p.longitude??p.lon);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)||!lat||!lon)return {...p,_radiusKm:null};
        return {...p,_radiusKm:ctDistanceKm(center.latitude,center.longitude,lat,lon)};
      }).filter(p=>p._radiusKm!==null&&p._radiusKm<=radius);
    }
    const privateOnly=$( "ctPrivateOnly")?.checked===true;
    const filtered=privateOnly?raw.filter(p=>{
      const seller=norm(p.seller_type||p.sellerType||p.advertiser_type||"");
      const isAgency=["pro","professionnel","agence","agency","mandataire","promoteur","notaire"].some(x=>seller===x||seller.includes(x));
      const exclusive=p.exclusive===true||p.exclusive==="true"||p.exclusivity===true||p.exclusivity==="true";
      return !isAgency&&!exclusive;
    }):raw;
    ctRender(filtered);
    const zone=ville?(radius>0?" dans un rayon de "+radius+" km autour de "+ville:" à "+ville):" dans les Ardennes";
    const sourceCounts={};raw.forEach(p=>{const s=String(p.source||"Source inconnue");sourceCounts[s]=(sourceCounts[s]||0)+1});const sourceSummary=Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).map(([s,n])=>s+" : "+n).join(" · ");$("ctStatus").textContent=filtered.length+" annonce(s) exploitables"+zone+" · "+(data.items?.length||0)+" reçue(s) · Sources : "+(sourceSummary||"aucune");
  }catch(e){$("ctStatus").textContent="Erreur ChercherTrouver : "+e.message;ctRender([])}
  finally{btn.disabled=false}
}
async function ctLocateAll(){
  const btn=$("ctLocateBtn");
  if(!btn||!ctAnnonces.length)return;
  btn.disabled=true;
  const limit=Math.min(10,ctAnnonces.length);
  $("ctStatus").textContent="Recherche des adresses publiques en cours : 0/"+limit+"…";
  for(let i=0;i<limit;i++){
    await ctFindAddress(i);
    $("ctStatus").textContent="Recherche des adresses publiques en cours : "+(i+1)+"/"+limit+"…";
  }
  $("ctStatus").textContent=limit+" bien(s) analysé(s) pour retrouver une adresse candidate via BAN + DPE. Vérifie chaque concordance avant prospection.";
  btn.disabled=false;
}
function ctAddSelected(){
  const selected=[...document.querySelectorAll("[data-ct-check]:checked")].map(x=>ctAnnonces[Number(x.dataset.ctCheck)]).filter(Boolean);
  let created=0,merged=0;
  for(const p of selected){
    const incoming={
      address:"",
      postalCode:p.postal_code||"",
      city:p.city||"",
      district:"",
      type:ctAnnonceType(p.type),
      area:num(p.surface),
      land:num(p.land_surface),
      rooms:num(p.rooms),
      bedrooms:num(p.bedrooms),
      price:num(p.price),
      dpe:p.dpe||"",
      detectionDate:today(),
      nextFollow:"",
      source:"ChercherTrouver · "+(p.source||"catalogue"),
      externalId:p.reference||"",
      sourceUrl:p.external_url||"",
      description:p.description||p.title||"",
      notes:"Annonce publique récupérée via ChercherTrouver. Signal commercial public : annonce active. Ne pas utiliser cette fiche pour identifier un propriétaire.",
      status:"Nouveau",
      publicListingActive:true,
      publicPriceDrop:Boolean(p.price_history?.previous && Number(p.price_history.previous)>Number(p.price||0)),
      publicListingReappeared:false
    };
    const result=mergeProspect(incoming);result==="created"?created++:merged++;
  }
  if(selected.length){save();alert("ChercherTrouver : "+created+" annonce(s) ajoutée(s), "+merged+" déjà présente(s) fusionnée(s).")}
}

function ctAddressMapLinks(c){
  const address=String(c?.address||"").trim();
  const query=[address,c?.postalCode,c?.city].filter(Boolean).join(", ");
  if(!query)return "";
  const encoded=encodeURIComponent(query);
  const lat=Number(c?.latitude),lon=Number(c?.longitude);
  const mapUrl="https://www.google.com/maps/search/?api=1&query="+encoded;
  const streetUrl=Number.isFinite(lat)&&Number.isFinite(lon)&&lat!==0&&lon!==0
    ?"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint="+encodeURIComponent(lat+","+lon)
    :mapUrl;
  return '<div class="ct-address-actions"><a class="ghost" href="'+streetUrl+'" target="_blank" rel="noopener">👁️ Vue rue</a><a class="ghost" href="'+mapUrl+'" target="_blank" rel="noopener">🗺️ Map View</a><button class="ghost" data-copy-address="'+apiEsc(query)+'">📋 Copier</button></div>';
}

async function ctFindAddress(index){
  const p=ctAnnonces[index],box=$("ct-address-result-"+index);
  if(!p||!box)return;
  if(!Number.isFinite(Number(p.latitude))||!Number.isFinite(Number(p.longitude))){box.innerHTML='<div class="meta">Cette annonce ne fournit pas de coordonnées exploitables pour la recherche gratuite.</div>';return}
  box.innerHTML='<div class="meta">Recherche BAN + DPE en cours…</div>';
  try{
    const qs=new URLSearchParams({lat:String(p.latitude),lon:String(p.longitude),area:String(p.surface||0),rooms:String(p.rooms||0),dpe:String(p.dpe||""),cityCode:String(p.city_code||p.cityCode||"")});
    const data=await publicJson("/api/address-candidates?"+qs.toString());
    const rows=data.candidates||[];
    box.innerHTML=rows.length?'<div class="ct-address-title">Adresses candidates · concordance technique</div>'+rows.map((c)=>'<div class="ct-address-candidate"><strong>'+apiEsc(c.address)+'</strong><span>'+apiEsc([c.postalCode,c.city].filter(Boolean).join(" "))+' · '+Math.round(c.distanceMeters||0)+' m · <b>'+Math.round(c.score||0)+'/100</b></span><small>'+apiEsc(c.priority==="priorite_geographique"?"🟠 Priorité géographique · DPE discordant":(c.confidence==="forte"?"🟢 Concordance forte":c.confidence==="interessante"?"🟡 Concordance intéressante":c.confidence==="a_verifier"?"🟠 À vérifier":"⚪ Concordance faible"))+'</small><small>'+apiEsc((c.reasons||[]).join(" · "))+'</small>'+(c.bdnb?.length?'<small>🏢 BDNB : bâtiment retrouvé · '+apiEsc(c.bdnb[0].address||"adresse BDNB")+(c.bdnb[0].units?' · '+c.bdnb[0].units+' unité(s)':"")+'</small>':"")+(c.dpe?'<small>DPE candidat : '+apiEsc(c.dpe.dpe||"—")+' · '+(c.dpe.area||"—")+' m² · '+(c.dpe.rooms||"—")+' pièce(s)</small>':"")+ctAddressMapLinks(c)+'</div>').join("")+'<div class="meta">Adresse non confirmée : le résultat sert à orienter le rapprochement public, pas à identifier un propriétaire.</div>':'<div class="meta">Aucune adresse candidate suffisamment documentée.</div>';
  }catch(e){box.innerHTML='<div class="meta">Erreur recherche adresse : '+apiEsc(e.message)+'</div>'}
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-ct-address]");if(b)ctFindAddress(Number(b.dataset.ctAddress));const copy=e.target.closest("[data-copy-address]");if(copy){const value=copy.dataset.copyAddress||"";navigator.clipboard?.writeText(value).then(()=>{const old=copy.textContent;copy.textContent="✅ Copié";setTimeout(()=>copy.textContent=old,1200)}).catch(()=>{})}});

if($("ctSearchBtn"))$("ctSearchBtn").onclick=ctSearch;
if($("ctTourBtn"))$("ctTourBtn").onclick=ctSectorTour;
if($("ctAddBtn"))$("ctAddBtn").onclick=ctAddSelected;


if($("ctLocateBtn"))$("ctLocateBtn").onclick=ctLocateAll;
