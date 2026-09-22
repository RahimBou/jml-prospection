/* JML Prospection — Laboratoire statistique V1.9.7
   Objectif: mesurer quelles méthodes repèrent le mieux les biens ayant ensuite
   un résultat commercial réel. Les scores restent des indicateurs, pas des
   probabilités ni des prédictions certaines. */
const STATS_KEY="jml_prospection_stats_v1";
const STATS_HORIZON=180;
const STATS_METHODS=[
  ["radar","Radar V1.7"],
  ["movement","Mouvement 6 mois"],
  ["price","Comportement prix"],
  ["persistence","Persistance / apparitions"],
  ["sources","Multi-sources"],
  ["futureRadar","Radar futur V1.17.2"],
  ["ensemble","Ensemble des méthodes"]
];

function statsLoad(){
  try{
    const x=JSON.parse(localStorage.getItem(STATS_KEY)||"{}");
    return x&&typeof x==="object"?x:{};
  }catch(e){return{}}
}
function statsSave(x){localStorage.setItem(STATS_KEY,JSON.stringify(x))}
function statsNum(v){const n=Number(v);return Number.isFinite(n)?n:0}
function statsDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d:null}
function statsDaysSince(v){const d=statsDate(v);return d?Math.max(0,(Date.now()-d.getTime())/86400000):0}
function statsClamp(n){return Math.max(0,Math.min(100,Math.round(n)))}

function statsFeatures(p){
  const sig=typeof signalInfo==="function"?signalInfo(p):{score:0,tags:[]};
  const mov=typeof movement6mInfo==="function"?movement6mInfo(p):{score:0};
  const h=Array.isArray(p.priceHistory)?p.priceHistory:[];
  const a=Array.isArray(p.appearanceHistory)?p.appearanceHistory:[];
  const sources=new Set(a.map(x=>x&&x.source).filter(Boolean)).size;
  const pc=typeof priceChangeInfo==="function"?priceChangeInfo(p):null;
  const age=statsDaysSince(p.detectionDate||p.firstDetectedAt||p.createdAt);
  const priceScore=pc&&pc.delta<0
    ? statsClamp(60+Math.min(40,Math.abs(pc.pct)*4))
    : Math.min(45,Math.max(0,(h.length-1)*15));
  const persistenceScore=statsClamp(
    Math.min(45,Math.max(0,(a.length-1)*15))+
    (age>=90?30:age>=60?20:age>=30?10:0)+
    (a.length>=2?15:0)
  );
  const sourceScore=statsClamp(sources>=3?100:sources===2?70:sources===1?35:0);
  const future=Number.isFinite(Number(p.futureRadarScore))?statsClamp(Number(p.futureRadarScore)):null;
  return {
    radar:statsClamp(sig.score*10),
    movement:statsClamp(mov.score),
    price:priceScore,
    persistence:persistenceScore,
    sources:sourceScore,
    futureRadar:future
  };
}
function statsEnsemble(f){
  const vals=[f.radar,f.movement,f.price,f.persistence,f.sources,f.futureRadar].filter(v=>Number.isFinite(v));
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
}
function statsOutcome(p){
  const history=Array.isArray(p.history)?p.history:[];
  const success=p.status==="Mandat obtenu"||
    history.some(h=>h&&h.type==="Changement de statut"&&String(h.text||"").includes("Mandat obtenu"));
  const failure=p.status==="Mandat refusé"||p.status==="Vendu / abandonné"||
    history.some(h=>h&&h.type==="Changement de statut"&&(/Mandat refusé|Vendu \/ abandonné/).test(String(h.text||"")));
  if(success)return "success";
  if(failure)return "failure";
  return "open";
}
function statsSnapshotFor(p){
  const f=statsFeatures(p);
  return {
    id:p.id,
    createdAt:p.createdAt||new Date().toISOString(),
    detectionDate:p.detectionDate||String(p.createdAt||new Date().toISOString()).slice(0,10),
    city:p.city||"",
    type:p.type||"",
    price:statsNum(p.price),
    area:statsNum(p.area),
    dpe:p.dpe||"",
    features:{...f,ensemble:statsEnsemble(f)},
    updatedAt:new Date().toISOString()
  };
}
function statsSync(){
  if(typeof prospects==="undefined")return;
  const db=statsLoad();
  let changed=false;
  for(const p of prospects){
    if(!p.id)continue;
    const previous=db[p.id];
    const next=statsSnapshotFor(p);
    if(previous){
      next.createdAt=previous.createdAt||next.createdAt;
      next.detectionDate=previous.detectionDate||next.detectionDate;
    }
    db[p.id]=next;
    changed=true;
  }
  const ids=new Set(prospects.map(p=>p.id));
  for(const id of Object.keys(db))if(!ids.has(id)){delete db[id];changed=true}
  if(changed)statsSave(db);
  statsRender();
}
function statsMatured(db){
  const now=Date.now();
  return Object.values(db).filter(s=>{
    const d=statsDate(s.detectionDate||s.createdAt);
    return d&&(now-d.getTime())>=STATS_HORIZON*86400000;
  });
}
function statsCurrentOutcome(s){
  const p=typeof prospects!=="undefined"?prospects.find(x=>x.id===s.id):null;
  return p?statsOutcome(p):"open";
}
function statsWilson(success,n){
  if(!n)return {rate:0,low:0,high:0};
  const z=1.96,ph=success/n,den=1+z*z/n,center=ph+z*z/(2*n),half=z*Math.sqrt(ph*(1-ph)/n+z*z/(4*n*n));
  return {rate:ph*100,low:Math.max(0,(center-half)/den*100),high:Math.min(100,(center+half)/den*100)};
}
function statsMethodMetrics(rows,key){
  if(!rows.length)return {n:0,success:0,rate:0,precision:0,lift:null};
  const eligible=rows.filter(s=>Number.isFinite(s.features?.[key])).map(s=>({...s,outcome:statsCurrentOutcome(s)}));
  const maturedSuccess=eligible.filter(s=>s.outcome==="success").length;
  const base=statsWilson(maturedSuccess,eligible.length);
  const sorted=eligible.slice().sort((a,b)=>statsNum(b.features?.[key])-statsNum(a.features?.[key]));
  const k=Math.max(1,Math.ceil(sorted.length*.2));
  const top=sorted.slice(0,k), topSuccess=top.filter(s=>s.outcome==="success").length;
  const precision=topSuccess/k*100;
  return {n:eligible.length,success:maturedSuccess,rate:base.rate,low:base.low,high:base.high,precision,lift:base.rate?precision/base.rate:null,k};
}
function statsRender(){
  const panel=document.getElementById("statsLab");
  if(!panel)return;
  const db=statsLoad(), rows=statsMatured(db);
  const total=Object.keys(db).length, successes=rows.filter(s=>statsCurrentOutcome(s)==="success").length;
  const base=statsWilson(successes,rows.length);
  const by=STATS_METHODS.map(([key,label])=>[key,label,statsMethodMetrics(rows,key)]);
  const enough=rows.length>=20;
  const learning=total-rows.length;
  panel.querySelector("#statsHeadline").textContent=total+" bien(s) suivis · "+learning+" en apprentissage · "+rows.length+" résultat(s) arrivés à maturité";
  panel.querySelector("#statsBaseline").textContent=rows.length?base.rate.toFixed(1)+" %":"—";
  panel.querySelector("#statsSuccess").textContent=rows.length?successes:"—";
  panel.querySelector("#statsDataQuality").textContent=enough?"Test exploitable":"Phase d'apprentissage";
  panel.querySelector("#statsTable").innerHTML=by.map(([key,label,m])=>{
    const lift=m.lift===null?"—":m.lift.toFixed(2)+"×";
    return "<tr><td><strong>"+esc(label)+"</strong></td><td>"+m.n+"</td><td>"+(m.n?m.precision.toFixed(1)+" %":"—")+"</td><td>"+lift+"</td><td>"+(m.n?m.low.toFixed(1)+"–"+m.high.toFixed(1)+" %":"—")+"</td></tr>";
  }).join("");
  const best=by.filter(x=>x[2].n).sort((a,b)=>(b[2].precision||0)-(a[2].precision||0))[0];
  panel.querySelector("#statsMessage").textContent=!total
    ?"Aucun prospect n'est encore enregistré. Ajoute les candidats du Radar futur pour alimenter le laboratoire."
    :!rows.length
      ?"Le laboratoire est prêt. Les biens récents sont en apprentissage et seront évalués après 180 jours."
    :!enough
      ?"Pas assez de résultats pour tirer une conclusion robuste : on conserve toutes les méthodes en parallèle."
      :best
        ?"Les méthodes sont comparées sur les 20 % de biens les mieux classés. La colonne Lift mesure l'amélioration par rapport au taux de base."
        :"Données en cours d'apprentissage.";
}
function statsRenderBacktest(data){
  const status=document.getElementById("statsBacktestStatus"),box=document.getElementById("statsBacktestResults");
  if(!status||!box)return;
  status.textContent=data.matched+" observations historiques · "+data.dvfCount+" mutations DVF · correspondances exactes : "+(data.exactMatched||0)+" ("+Number(data.exactMatchRate||0).toFixed(1)+" %) · taux de base 180 j : "+data.baseline.toFixed(1)+" %";
  const note=data.baseline===0?"Aucune vente à la même adresse n’est actuellement détectée dans la fenêtre de 180 jours. Ce 0 % décrit le résultat du protocole de rapprochement historique, pas la performance du radar.":"Le taux de base est calculé sur les ventes correspondant à la même adresse dans les 180 jours.";
  box.innerHTML="<table class='stats-table'><thead><tr><th>Méthode</th><th>Échantillon</th><th>Top 20 % positif</th><th>Précision</th><th>Lift</th></tr></thead><tbody>"+
    data.metrics.map(m=>"<tr><td><strong>"+esc(m.label)+"</strong></td><td>"+m.n+"</td><td>"+m.success+" / "+m.k+"</td><td>"+m.precision.toFixed(1)+" %</td><td>"+(m.lift===null?"—":m.lift.toFixed(2)+"×")+"</td></tr>").join("")+
    "</tbody></table><div class='stats-foot'>"+esc(data.disclaimer)+"</div>";
}
async function statsBacktest(){
  const status=document.getElementById("statsBacktestStatus");
  const q=document.getElementById("publicQuery")?.value.trim();
  if(!q){if(status)status.textContent="Indique d’abord une commune, par exemple Sedan.";return}
  if(status)status.textContent="Test historique en cours…";
  try{
    const r=await fetch("/api/backtest?q="+encodeURIComponent(q)+"&years=5");
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"Erreur du backtest");
    statsRenderBacktest(data);
  }catch(e){if(status)status.textContent="Erreur : "+e.message}
}
function statsExport(){
  const blob=new Blob([JSON.stringify(statsLoad(),null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="jml-laboratoire-statistique.json";a.click();URL.revokeObjectURL(url);
}
function statsInit(){
  statsSync();
  const b=document.getElementById("statsRefresh");if(b)b.onclick=statsSync;
  const e=document.getElementById("statsExport");if(e)e.onclick=statsExport;
  const backtestBtn=document.getElementById("statsBacktest");if(backtestBtn)backtestBtn.onclick=statsBacktest;
  setInterval(statsSync,30000);
}
document.addEventListener("DOMContentLoaded",statsInit);
