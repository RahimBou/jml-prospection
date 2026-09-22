const APP_VERSION="1.17.3";
const KEY="jml_prospection_v1";let prospects=load(),pendingImport=[];const $=id=>document.getElementById(id);
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(x)?x:[]}catch(e){return[]}}
function save(){localStorage.setItem(KEY,JSON.stringify(prospects));render();if(typeof statsSync==="function")statsSync()}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function now(){return new Date().toISOString()}
function today(){return new Date().toISOString().slice(0,10)}
function norm(v=""){return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/œ/g,"oe").replace(/æ/g,"ae").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function dedupeKey(p){const cp=String(p.postalCode||"").replace(/\D/g,"");return [norm(p.address),cp,norm(p.city),norm(p.type)].filter(Boolean).join("|")}
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
function render(){
 const q=$("q").value.toLowerCase().trim(),city=$("city").value.toLowerCase().trim(),district=$("districtFilter").value.toLowerCase().trim(),type=$("type").value,status=$("status").value,dpe=$("dpeFilter").value,signal=$("signalFilter").value,movement=$("movementFilter").value;
 const priceMin=$("priceMin").value,priceMax=$("priceMax").value,areaMin=$("areaMin").value,areaMax=$("areaMax").value,landMin=$("landMin").value,landMax=$("landMax").value,roomsMin=$("roomsMin").value,roomsMax=$("roomsMax").value,from=$("detectedFrom").value,to=$("detectedTo").value;
 let rows=prospects.filter(p=>{
  const hay=[p.address,p.postalCode,p.city,p.district,p.description,p.notes,p.source,p.externalId].join(" ").toLowerCase();
  const detected=p.detectionDate||String(p.createdAt||"").slice(0,10);
  return (!q||hay.includes(q))&&(!city||String(p.city||"").toLowerCase().includes(city))&&(!district||String(p.district||"").toLowerCase().includes(district))&&(!type||p.type===type)&&(!status||p.status===status)&&(!dpe||(dpe==="Non renseigné"?!p.dpe:p.dpe===dpe))&&(!signal||(signal==="any"?hasSignal(p):signal==="none"?!hasSignal(p):signalInfo(p).tags.some(t=>t.key===signal)))&&(!movement||(movement==="high"?movement6mInfo(p).score>=65:movement==="medium"?movement6mInfo(p).score>=40&&movement6mInfo(p).score<65:movement==="watch"?movement6mInfo(p).score>=20&&movement6mInfo(p).score<40:movement6mInfo(p).score<20))&&inRange(p.price,priceMin,priceMax)&&inRange(p.area,areaMin,areaMax)&&inRange(p.land,landMin,landMax)&&inRange(p.rooms,roomsMin,roomsMax)&&(!from||detected>=from)&&(!to||detected<=to);
 });
 const sort=$("sort").value;
 if(sort==="signal")rows.sort((a,b)=>movement6mInfo(b).score-movement6mInfo(a).score||signalInfo(b).score-signalInfo(a).score||String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));else if(sort==="city")rows.sort((a,b)=>String(a.city).localeCompare(String(b.city)));else if(sort==="price")rows.sort((a,b)=>b.price-a.price);else if(sort==="priceM2")rows.sort((a,b)=>priceM2(b)-priceM2(a));else if(sort==="area")rows.sort((a,b)=>b.area-a.area);else if(sort==="follow")rows.sort((a,b)=>(a.nextFollow||"9999").localeCompare(b.nextFollow||"9999"));else if(sort==="detection")rows.sort((a,b)=>(b.detectionDate||b.createdAt||"").localeCompare(a.detectionDate||a.createdAt||""));else rows.sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
 $("resultCount").textContent=rows.length+" résultat"+(rows.length>1?"s":"");$("empty").style.display=rows.length?"none":"block";
 $("list").innerHTML=rows.map(p=>'<article class="card"><div class="card-head"><div><div class="address">'+esc(p.address)+'</div><div class="meta">'+esc(p.postalCode?p.postalCode+" ":"")+esc(p.city)+(p.district?" · "+esc(p.district):"")+" · "+esc(p.type)+'</div></div><span class="badge '+badgeClass(p.status)+'">'+esc(p.status)+'</span></div>'+(p.price?'<div class="price">'+p.price.toLocaleString("fr-FR")+' €</div>':"")+'<div class="details">'+(p.area?'<span class="detail">'+p.area+' m²</span>':"")+(p.land?'<span class="detail">Terrain '+p.land+' m²</span>':"")+(p.rooms?'<span class="detail">'+p.rooms+' pièces</span>':"")+(p.bedrooms?'<span class="detail">'+p.bedrooms+' ch.</span>':"")+(p.dpe?'<span class="detail">DPE '+esc(p.dpe)+'</span>':'<span class="detail">DPE —</span>')+(priceM2(p)?'<span class="detail">'+Math.round(priceM2(p)).toLocaleString("fr-FR")+' €/m²</span>':"")+(p.source?'<span class="detail">'+esc(p.source)+'</span>':"")+'</div>'+(p.description?'<div class="signal">'+esc(p.description)+'</div>':"")+'<div class="meta">Détection : '+(p.detectionDate?new Date(p.detectionDate+"T00:00:00").toLocaleDateString("fr-FR"):"non définie")+' · Relance : '+(p.nextFollow?new Date(p.nextFollow+"T00:00:00").toLocaleDateString("fr-FR"):"non définie")+'</div>'+signalInfo(p).tags.filter(t=>t.points>0).map(t=>'<span class="signal-tag">'+esc(t.label)+(t.key==="priceDown"&&signalInfo(p).priceChange?' · '+Math.abs(signalInfo(p).priceChange.pct).toFixed(1)+' %':"")+'</span>').join("")+movement6mHtml(p)+priceHistoryHtml(p)+'<div class="card-actions"><button class="ghost" data-edit="'+p.id+'">Ouvrir / modifier</button>'+(p.sourceUrl?'<a class="ghost" href="'+esc(p.sourceUrl)+'" target="_blank" rel="noopener">Source</a>':"")+'<button class="ghost" data-delete="'+p.id+'">Supprimer</button></div></article>').join("");
 $("statTotal").textContent=prospects.length;$("statNew").textContent=prospects.filter(p=>p.status==="Nouveau").length;$("statFollow").textContent=prospects.filter(p=>p.status==="À relancer").length;$("statSignals").textContent=prospects.filter(p=>signalInfo(p).score>0).length;const totalSignals=prospects.reduce((n,p)=>n+signalInfo(p).score,0),movementHigh=prospects.filter(p=>movement6mInfo(p).score>=65).length,movementMedium=prospects.filter(p=>movement6mInfo(p).score>=40&&movement6mInfo(p).score<65).length; $("radarSummary").textContent=totalSignals+" points de signal · "+movementHigh+" priorité"+(movementHigh>1?"s":"")+" / "+movementMedium+" potentiels";$("signalChips").innerHTML=["new","old","follow","dpe","land","multi","priceDown","incomplete","sufficient"].map(k=>{const n=prospects.filter(p=>signalInfo(p).tags.some(t=>t.key===k)).length;const label={new:"Nouveaux",old:"Anciens",follow:"Relances en retard",dpe:"DPE F/G",land:"Terrains importants",multi:"Sources multiples",priceDown:"Baisses de prix",incomplete:"Données à compléter",sufficient:"Données suffisantes"}[k];return n?"<button class=\"signal-chip\" data-signal=\""+k+"\">"+label+" · "+n+"</button>":""}).join("")
}
function badgeClass(s){return s==="Mandat obtenu"?"green":s==="À relancer"?"hot":""}
function mergeProspect(incoming){const key=dedupeKey(incoming),idx=prospects.findIndex(p=>dedupeKey(p)===key),date=now();if(idx<0){const created={id:crypto.randomUUID(),...incoming,detectionDate:incoming.detectionDate||today(),history:[{date,type:"Import CSV",text:"Bien importé dans la base."}],priceHistory:incoming.price?[{date,price:incoming.price,source:incoming.source||"",reason:"Création"}]:[],appearanceHistory:[{date,source:incoming.source||"",sourceUrl:incoming.sourceUrl||"",externalId:incoming.externalId||""}],firstDetectedAt:incoming.detectionDate||today(),lastSeenAt:date,createdAt:date,updatedAt:date};prospects.push(created);return"created"}const old=ensureHistory({...prospects[idx]}),history=[...(old.history||[])];history.push({date,type:"Mise à jour source",text:incoming.source?"Données reçues depuis "+incoming.source+".":"Données importées et fusionnées."});const merged={...old};const oldPrice=num(old.price),newPrice=num(incoming.price);for(const[k,v]of Object.entries(incoming)){if(v!==""&&v!==null&&v!==undefined&&(typeof v!=="number"||v!==0))merged[k]=v}if(newPrice&&newPrice!==oldPrice){merged.priceHistory=[...(old.priceHistory||[]),{date,price:newPrice,previousPrice:oldPrice,source:incoming.source||"",reason:"Changement de prix"}];history.push({date,type:"Changement de prix",text:(oldPrice?oldPrice.toLocaleString("fr-FR")+" € → ":"")+" "+newPrice.toLocaleString("fr-FR")+" €"});}const appearance={date,source:incoming.source||"",sourceUrl:incoming.sourceUrl||"",externalId:incoming.externalId||""};const last=(old.appearanceHistory||[])[(old.appearanceHistory||[]).length-1];if(!last||[appearance.source,appearance.sourceUrl,appearance.externalId].some((v,i)=>v!==[last.source,last.sourceUrl,last.externalId][i]))merged.appearanceHistory=[...(old.appearanceHistory||[]),appearance];merged.history=history;merged.lastSeenAt=date;merged.updatedAt=date;prospects[idx]=merged;return"merged"}
$("addBtn").onclick=()=>openForm();$("closeBtn").onclick=closeForm;$("cancelBtn").onclick=closeForm;
$("prospectForm").onsubmit=e=>{e.preventDefault();const d=formData(),id=$("editId").value,action=$("actionNote").value.trim(),date=now();if(!d.address||!d.city)return;if(id){const i=prospects.findIndex(p=>p.id===id);if(i<0)return;const old=prospects[i],history=[...(old.history||[])];if(old.status!==d.status)history.push({date,type:"Changement de statut",text:old.status+" → "+d.status});if(action)history.push({date,type:"Action / note",text:action});const updated=ensureHistory({...old,...d});if(num(old.price)!==num(d.price)&&num(d.price)){updated.priceHistory=[...(old.priceHistory||[]),{date,price:num(d.price),previousPrice:num(old.price),source:d.source||"",reason:"Changement de prix"}];history.push({date,type:"Changement de prix",text:(old.price?num(old.price).toLocaleString("fr-FR")+" € → ":"")+" "+num(d.price).toLocaleString("fr-FR")+" €"});}updated.appearanceHistory=old.appearanceHistory?.length?old.appearanceHistory:[{date,source:d.source||"",sourceUrl:d.sourceUrl||"",externalId:d.externalId||""}];updated.history=history;updated.updatedAt=date;updated.lastSeenAt=date;prospects[i]=updated}else{const duplicate=prospects.find(p=>dedupeKey(p)===dedupeKey(d));if(duplicate){alert("Ce bien existe déjà dans la base. Ouvre sa fiche pour le modifier.");openForm(duplicate);return}prospects.push({id:crypto.randomUUID(),...d,history:[{date,type:"Création",text:action||"Prospect créé"}],priceHistory:d.price?[{date,price:d.price,source:d.source||"",reason:"Création"}]:[],appearanceHistory:[{date,source:d.source||"",sourceUrl:d.sourceUrl||"",externalId:d.externalId||""}],firstDetectedAt:d.detectionDate||today(),lastSeenAt:date,createdAt:date,updatedAt:date})}save();closeForm()};
$("resetBtn").onclick=()=>{["q","city","districtFilter","type","status","dpeFilter","signalFilter","movementFilter","priceMin","priceMax","areaMin","areaMax","landMin","landMax","roomsMin","roomsMax","detectedFrom","detectedTo"].forEach(id=>$(id).value="");render()};
["q","city","districtFilter","type","status","dpeFilter","signalFilter","movementFilter","priceMin","priceMax","areaMin","areaMax","landMin","landMax","roomsMin","roomsMax","detectedFrom","detectedTo","sort"].forEach(id=>$(id).addEventListener("input",render));$("signalChips").onclick=e=>{const b=e.target.closest("[data-signal]");if(b){$("signalFilter").value=b.dataset.signal;render()}};
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
  if(!futureRadarCandidates.length){
    box.innerHTML='<div class="meta">Aucun candidat exploitable trouvé pour cette analyse.</div>';
    if(add)add.disabled=true;
    return;
  }
  box.innerHTML=futureRadarCandidates.slice(0,100).map((p,i)=>{
    const ms=p.methodScores||{},ev=p.evidence||{};
    const comps=p.comparableCount||0;
    const median=p.comparableMedianPriceM2?Math.round(p.comparableMedianPriceM2).toLocaleString("fr-FR")+" €/m²":"—";
    const radius=p.comparableRadius?p.comparableRadius+" m":"—";
    const compText=comps
      ? "🔵 "+comps+" comparable(s) distinct(s) · distance médiane "+(p.comparableMedianDistance!=null?Math.round(p.comparableMedianDistance)+" m":"—")+" · rayon "+radius
      : "⚪ Aucun comparable DVF distinct suffisamment proche";
    const dpeConfirmed=p.dpeConfirmed===true;
    const dpeText=dpeConfirmed
      ? "🟢 DPE "+(p.dpe||"—")+" confirmé · même adresse"
      : p.dpeAddressStatus==="uncertain"
        ? "🟠 DPE trouvé · adresse/unité non confirmée"
        : "⚪ DPE non confirmé à la même adresse";
    const dpeClass=dpeConfirmed?"confirmed":p.dpeAddressStatus==="uncertain"?"uncertain":"none";

    const sale=p.sameAddressSale||{};
    const saleText=sale.status==="confirmed"
      ? "🟢 Vente DVF à la même adresse · "+(sale.count||0)+" mutation(s) · dernière "+(sale.latest?.date?new Date(sale.latest.date).toLocaleDateString("fr-FR"):"date inconnue")+" · "+(sale.ageYears!=null?Math.round(sale.ageYears)+" an(s)":"âge —")
      : sale.status==="ambiguous"
        ? "🟠 Adresse DVF exacte mais logement ambigu · vente non confirmée"
        : "⚪ Aucune vente DVF confirmée à la même adresse";
    const saleClass=sale.status==="confirmed"?"confirmed":sale.status==="ambiguous"?"uncertain":"none";

    const terrain=p.terrainArea?("🌳 Terrain documenté par DVF : "+Math.round(p.terrainArea)+" m²"):"🌳 Terrain non documenté à la même adresse";
    const quality=ev.dataQuality||p.dataQuality||{};
    const why=(p.reasons||[]).filter(x=>!String(x).startsWith("DPE ")&&!String(x).startsWith("Dernière vente")&&!String(x).startsWith("Aucune vente")&&!String(x).startsWith("Adresse DVF")).slice(0,5);

    return '<article class="future-candidate"><div class="future-candidate-main"><label class="future-check"><input type="checkbox" data-future-check="'+i+'" checked><span></span></label><div><strong>'+apiEsc(p.address||"Adresse non renseignée")+'</strong><div class="meta">'+apiEsc((p.postalCode?p.postalCode+" ":"")+(p.city||""))+' · '+apiEsc(futureRadarType(p.buildingType))+(p.area?" · "+p.area+" m²":"")+'</div><div class="future-reasons"><span class="dpe-match '+dpeClass+'">'+apiEsc(dpeText)+'</span><span class="dpe-match '+saleClass+'">'+apiEsc(saleText)+'</span><span>'+apiEsc(compText)+'</span><span>'+apiEsc(terrain)+'</span></div><div class="future-reasons">'+why.map(x=>'<span>'+apiEsc(x)+'</span>').join("")+'</div><div class="meta"><strong>Pourquoi ce candidat ?</strong> Qualité '+(quality.score||0)+'/5 · type/surface '+(ms.typeSurface||0)+'% · proximité '+(ms.proximity||0)+'% · historique '+(ms.history||0)+'%</div></div></div><div class="future-score"><strong>'+p.score+'/100</strong><small>indice de surveillance</small><em>DPE '+(ms.dpe||0)+' · vente '+(ms.saleAge||0)+' · type/surface '+(ms.typeSurface||0)+' · terrain '+(ms.terrain||0)+' · proximité '+(ms.proximity||0)+' · historique '+(ms.history||0)+' · données '+(ms.data||0)+'</em></div></article>';
  }).join("");
  add.disabled=false;
}
async function runFutureRadar(){
  const q=$("publicQuery").value.trim();
  if(!q){$("futureRadarStatus").textContent="Indique d'abord une commune dans le champ « Commune ou adresse ».";return}
  $("futureRadarStatus").textContent="Analyse ADEME + comparables géographiques DVF en cours…";
  $("futureRadarBtn").disabled=true;
  try{
    const data=await publicJson("/api/radar?q="+encodeURIComponent(q)+"&limit=100&years=5");
    futureRadarCandidates=data.results||[];
    futureRadarRender();
    $("futureRadarStatus").innerHTML="<strong>"+apiEsc(q)+"</strong> · "+data.dpeCount+" DPE analysés · "+data.dvfCount+" transactions comparées · "+futureRadarCandidates.length+" candidats classés. "+apiEsc(data.dvfFallback?"DVF open-data utilisé en secours.":"DVF+ utilisé.");
  }catch(e){
    futureRadarCandidates=[];
    futureRadarRender();
    $("futureRadarStatus").textContent="Erreur radar futur : "+e.message;
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
      futureRadarScore:num(p.score),dataQuality:p.dataQuality||null,status:"Nouveau",
      detectionDate:today(),nextFollow:"",source:"Radar futur · ADEME + comparables DVF",
      externalId:p.id||"",sourceUrl:"https://data.ademe.fr/datasets/dpe03existant",
      description:"Indice de surveillance : "+p.score+"/100. "+(p.reasons||[]).join(" · "),
      notes:"Séparation des preuves : DPE même adresse = "+(p.dpeConfirmed?"confirmé":"non confirmé")+" ; vente DVF même adresse = "+(p.sameAddressSaleConfirmed?"confirmée":"non confirmée")+" ; comparables distincts = "+(p.comparableCount||0)+". Qualité "+(p.dataQuality?.label||"non précisée")+". Historique DVF confirmé : "+(p.sameAddressSale?.count||0)+" vente(s). "+(p.disclaimer||"")
    };
    const result=mergeProspect(incoming);
    result==="created"?created++:merged++;
  }
  if(selected.length){save();alert("Radar futur : "+created+" candidat(s) ajouté(s), "+merged+" déjà présent(s) fusionné(s).")}
}
$("futureRadarBtn").onclick=runFutureRadar;
$("futureRadarAddAll").onclick=addFutureRadarCandidates;
let publicDpeResults=[],publicDvfResults=[];
function apiEsc(v=""){return esc(v)}
async function publicJson(url){let r;try{r=await fetch(url,{cache:"no-store"});}catch(e){throw new Error("Connexion au serveur JML impossible : "+(e.message||"fetch failed"))}let d;try{d=await r.json()}catch(e){throw new Error("Réponse serveur invalide (HTTP "+r.status+")")}if(!r.ok)throw new Error(d.error||("Erreur serveur HTTP "+r.status));return d}
function renderPublicDpe(rows){
  publicDpeResults=rows||[];
  $("publicDpeResults").innerHTML=publicDpeResults.length?publicDpeResults.slice(0,20).map((p,i)=>'<article class="source-result"><div><strong>'+apiEsc(p.address||"Adresse non renseignée")+'</strong><span>'+apiEsc((p.postalCode?p.postalCode+" ":"")+(p.city||""))+'</span></div><div class="source-result-details">'+(p.area?p.area+" m² · ":"")+(p.dpe?"DPE "+apiEsc(p.dpe):"DPE —")+(p.ges?" · GES "+apiEsc(p.ges):"")+'</div><button class="ghost" data-dpe-index="'+i+'">Préparer une fiche</button></article>').join(""):'<div class="meta">Aucun DPE trouvé pour cette recherche.</div>';
}
function renderPublicDvf(rows){
  publicDvfResults=rows||[];
  $("publicDvfResults").innerHTML=publicDvfResults.length?publicDvfResults.slice(0,20).map(p=>'<article class="source-result"><div><strong>'+apiEsc(p.date||"Date inconnue")+'</strong><span>'+apiEsc(p.type||"Bien immobilier")+'</span></div><div class="source-result-details">'+(p.value?p.value.toLocaleString("fr-FR")+" € · ":"")+(p.builtArea?p.builtArea+" m² bâti · ":"")+(p.landArea?p.landArea+" m² terrain":"")+'</div><span class="meta">Source : '+apiEsc(p.source||"DVF open-data")+' · '+apiEsc(p.cityCode||"")+'</span></article>').join(""):'<div class="meta">Aucune transaction trouvée.</div>';
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
    const key=String(q).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    let c=known[key];
    if(!c){
      const communes=await publicJson("/api/commune?q="+encodeURIComponent(q));
      c=communes[0];
    }
    if(!c)throw new Error("Commune introuvable");
    const params="codeInsee="+encodeURIComponent(c.cityCode);
    const [dpeResult,dvfResult]=await Promise.allSettled([
      publicJson("/api/dpe?"+params+"&limit=20"),
      publicJson("/api/dvf?"+params+"&limit=20&yearMin="+(new Date().getFullYear()-5))
    ]);
    const dpe=dpeResult.status==="fulfilled"?dpeResult.value:null;
    const dvf=dvfResult.status==="fulfilled"?dvfResult.value:null;
    const dvfError=dvfResult.status==="rejected"?String(dvfResult.reason?.message||"erreur source DVF+"): "";
    renderPublicDpe(dpe?.results||[]);
    renderPublicDvf(dvf?.results||[]);
    const parts=[
      "<strong>"+apiEsc(c.city)+"</strong> · code INSEE "+apiEsc(c.cityCode),
      dpe ? dpe.rawCount+" DPE récupérés" : "ADEME indisponible",
      dvf ? dvf.rawCount+" transactions récupérées · "+apiEsc(dvf.source||"DVF open-data")+(dvf.fallback?" (secours après indisponibilité Cerema)":"") : "DVF indisponible ("+apiEsc(dvfError)+")"
    ];
    $("publicStatus").innerHTML=parts.join(" · ");
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
prospects.forEach(ensureHistory);render();
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
  catch(e){ $("integrationsStatus").textContent="Erreur de test : "+e.message; $("chercherTrouverStatus").textContent="—"; }
  finally{$("integrationsTestBtn").disabled=false}
}
if($("integrationsTestBtn")) $("integrationsTestBtn").onclick=testIntegrations;
