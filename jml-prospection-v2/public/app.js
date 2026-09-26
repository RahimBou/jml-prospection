const $ = id => document.getElementById(id);
let snapshot = null;
let activeTab = "current";
const MEMORY_KEY = "jml-prospection-v2-memory";

async function getJSON(url){const res=await fetch(url,{cache:"no-store"});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||"Erreur HTTP "+res.status);return data;}
function params(){return new URLSearchParams({dept:$("dept").value.trim(),ville:$("city").value.trim(),radius_km:$("radius").value,web_sources:$("sources").value});}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function escapeAttr(v){return escapeHtml(v);}
function key(item){return item.id||item.external_url||[item.address,item.title,item.price,item.surface].join("|");}
function loadMemory(){try{return JSON.parse(localStorage.getItem(MEMORY_KEY)||"{}");}catch{return {};}}
function saveMemory(m){localStorage.setItem(MEMORY_KEY,JSON.stringify(m));}
function updateMemory(current){
 const memory=loadMemory(), now=new Date().toISOString(), seen=new Set(current.map(key)), disappeared=[];
 for(const [k,old] of Object.entries(memory)){
   if(old.present && !seen.has(k)){disappeared.push({...old,lastSeenAt:old.lastSeenAt||now});old.present=false;old.disappearedAt=now;}
 }
 for(const item of current){
   const k=key(item), old=memory[k];
   if(!old) memory[k]={...item,firstSeenAt:now,lastSeenAt:now,initialPrice:Number(item.price)||0,present:true,seenCount:1};
   else {old.lastSeenAt=now;old.present=true;old.seenCount=(old.seenCount||0)+1;old.currentPrice=Number(item.price)||0;}
 }
 saveMemory(memory);
 return {memory,disappeared};
}
function priceChanges(current){
 const memory=loadMemory(), out=[];
 for(const item of current){const old=memory[key(item)];if(!old)continue;const before=Number(old.initialPrice||old.currentPrice||0), now=Number(item.price||0);if(before>0&&now>0&&now!==before)out.push({...item,old_price:before,price_change:now-before});}
 return out;
}
function renderStats(counts={},market={}){
 $("stats").innerHTML=[
 ["Annonces en ligne",counts.current_listings||0],
 ["À vérifier terrain",counts.hidden_opportunities||0],
 ["Disparues",counts.disappeared||0],
 ["Prix modifiés",counts.price_changes||0],
 ["Transactions DVF",market.transactions||0],
 ["Prix médian DVF/m²",market.median_price_m2?market.median_price_m2.toLocaleString("fr-FR")+" €":"—"]
 ].map(([l,v])=>'<div class="stat"><span>'+l+'</span><b>'+v+'</b></div>').join("");
}
function renderCurrent(items=[]){
 return items.map(item=>{
  const price=Number(item.price)>0?Number(item.price).toLocaleString("fr-FR")+" €":"Prix non détecté";
  const surface=Number(item.surface)>0?Number(item.surface).toLocaleString("fr-FR")+" m²":"Surface non détectée";
  return '<article class="card"><h3>'+escapeHtml(item.title||"Bien immobilier")+'</h3><div class="meta"><b>'+price+'</b> · '+surface+'</div><div class="meta">'+escapeHtml(item.city||"")+" · "+escapeHtml(item.agency||item.source||"")+'</div><span class="tag">'+escapeHtml(item.property_type||"immobilier")+'</span>'+(item.external_url?'<p><a target="_blank" rel="noopener" href="'+escapeAttr(item.external_url)+'">Voir la fiche publique</a></p>':'')+'</article>';
 }).join("");
}
function renderHidden(items=[]){
 return items.map(item=>'<article class="card priority"><div class="score">'+Number(item.score||0)+'/100</div><h3>'+escapeHtml(item.address)+'</h3><div class="meta">'+escapeHtml(item.city||"")+' · '+(item.surface||"—")+' m² · DPE <b>'+escapeHtml(item.dpe||"—")+'</b></div><div class="reasons">'+(item.reason||[]).map(x=>'<span class="tag">'+escapeHtml(x)+'</span>').join(" ")+'</div><button class="field-btn" data-address="'+escapeAttr(item.address)+'">📍 Préparer cette adresse</button></article>').join("");
}
function renderDisappeared(items=[]){
 return items.map(item=>'<article class="card"><h3>'+escapeHtml(item.title||item.address||"Annonce")+'</h3><div class="meta">'+escapeHtml(item.city||"")+' · dernière présence '+escapeHtml(item.lastSeenAt||"")+'</div><span class="tag">Statut à vérifier</span></article>').join("");
}
function renderPrice(items=[]){
 return items.map(item=>'<article class="card"><h3>'+escapeHtml(item.title||"Bien")+'</h3><div class="meta">'+Number(item.old_price||0).toLocaleString("fr-FR")+' € → '+Number(item.price||0).toLocaleString("fr-FR")+' €</div><span class="tag">'+(Number(item.price_change)>0?"Hausse":"Baisse")+' de '+Math.abs(Number(item.price_change||0)).toLocaleString("fr-FR")+' €</span></article>').join("");
}
function render(){
 const data=snapshot||{};
 let items=[], title="";
 if(activeTab==="current"){items=data.current||[];title="🎯 Annonces en ligne";}
 if(activeTab==="hidden"){items=data.hidden||[];title="🟠 Adresses à vérifier sur le terrain";}
 if(activeTab==="disappeared"){items=data.disappeared||[];title="🟡 Annonces disparues — statut à vérifier";}
 if(activeTab==="price"){items=data.price_changes||[];title="🔵 Évolutions de prix";}
 $("sectionTitle").textContent=title;$("count").textContent=items.length+" résultat(s)";
 if(!items.length){$("results").innerHTML='<div class="empty">Aucun résultat dans cette catégorie.</div>';return;}
 $("results").innerHTML=activeTab==="current"?renderCurrent(items):activeTab==="hidden"?renderHidden(items):activeTab==="disappeared"?renderDisappeared(items):renderPrice(items);
}
async function search(){
 $("status").textContent="Recherche…";
 try{const data=await getJSON("/api/annonces?"+params());const mem=updateMemory(data.items||[]);snapshot={current:data.items||[],hidden:[],disappeared:mem.disappeared,price_changes:priceChanges(data.items||[]),counts:{current_listings:data.total||0,hidden_opportunities:0,disappeared:mem.disappeared.length,price_changes:priceChanges(data.items||[]).length}};renderStats(snapshot.counts);render();$("status").textContent=data.total+" annonce(s)";}catch(e){$("status").textContent="Erreur";$("message").textContent=e.message;}
}
async function market(){
 $("status").textContent="Radar en cours…";$("message").textContent="Croisement Web public + DVF + DPE…";
 try{
  const data=await getJSON("/api/marche?"+params());
  const mem=updateMemory(data.current||[]);
  snapshot={...data,disappeared:mem.disappeared,price_changes:priceChanges(data.current||[])};
  snapshot.counts.disappeared=mem.disappeared.length;snapshot.counts.price_changes=snapshot.price_changes.length;
  renderStats(snapshot.counts,snapshot.market);render();$("status").textContent="Radar terminé";$("message").textContent=(data.errors||[]).length?"⚠ "+data.errors.join(" · "):"✓ Sources traitées";
 }catch(e){$("status").textContent="Erreur";$("message").textContent=e.message;}
}
async function health(){
 try{const data=await getJSON("/api/sources");$("status").textContent="Sources";$("message").textContent=data.sources.map(x=>x.label+" : "+x.status).join(" · ");}catch(e){$("status").textContent="Erreur";}
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeTab=b.dataset.tab;render();}));
$("search").addEventListener("click",search);$("market").addEventListener("click",market);$("health").addEventListener("click",health);
getJSON("/api/health").then(d=>$("status").textContent="V"+d.version).catch(()=>$("status").textContent="Serveur indisponible");