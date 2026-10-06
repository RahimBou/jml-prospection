"use strict";

/**
 * Adaptateurs de repères immobiliers publics.
 *
 * Principe:
 * - chaque source possède son URL et son parseur;
 * - aucune tentative de contournement de CAPTCHA/anti-bot;
 * - on préfère un repère public au niveau ville/quartier lorsqu'un
 *   simulateur interactif n'est pas directement exploitable;
 * - le résultat est explicitement marqué "repère" et non "estimation
 *   officielle du site" lorsque nous n'avons pas obtenu le simulateur.
 */

const DEFAULT_TIMEOUT_MS = 12000;

function slugify(value="") {
  return String(value)
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/['’]/g,"-")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function numberFromText(value) {
  const s=String(value??"")
    .replace(/&nbsp;|\u00a0/g," ")
    .replace(/€/g,"")
    .replace(/\s/g,"")
    .replace(/\.(?=\d{3}(?:\D|$))/g,"")
    .replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}

function decodeHtml(value="") {
  return String(value)
    .replace(/&nbsp;/gi," ")
    .replace(/&#xA0;/gi," ")
    .replace(/&euro;/gi,"€")
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function text(html="") {
  return decodeHtml(html);
}

function matchNumberNear(html, pattern) {
  const m=String(html).match(pattern);
  return m ? numberFromText(m[1]||m[0]) : null;
}

async function fetchHtml(url, timeoutMs=DEFAULT_TIMEOUT_MS) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(url,{
      redirect:"follow",
      headers:{
        "User-Agent":"JML-Prospection/2.0 (public-market-research)",
        "Accept":"text/html,application/xhtml+xml"
      },
      signal:controller.signal
    });
    const body=await response.text();
    return {ok:response.ok,status:response.status,url:response.url,body};
  } finally {
    clearTimeout(timer);
  }
}

function propertyKind(type="") {
  const t=String(type).toLowerCase();
  if(/appartement|studio|duplex|loft/.test(t))return "appartement";
  if(/maison|villa|pavillon/.test(t))return "maison";
  return "";
}

function baseResult(id,label,url) {
  return {id,label,url,status:"not_found",kind:"public_market_repere",valuePerM2:null,estimatedValue:null,lowPerM2:null,highPerM2:null,confidence:"—",method:""};
}

function finalize(result,input) {
  if(Number.isFinite(result.valuePerM2) && result.valuePerM2>0 && Number(input.area)>0) {
    result.estimatedValue=Math.round(result.valuePerM2*Number(input.area));
  }
  if(result.status==="ok" && !result.method) result.method="Repère public €/m²";
  return result;
}

async function pap(p){
  let url="https://www.pap.fr/vendeur/prix-m2/"+slugify(p.city)+(p.postalCode?"-"+p.postalCode:"");
  let r=baseResult("pap","PAP",url);
  try{
    let x=await fetchHtml(url);
    if(!x.ok && p.department==="08"){url="https://www.pap.fr/vendeur/prix-m2/ardennes-08-g371";x=await fetchHtml(url);r.url=url}
    if(!x.ok){r.status="http_"+x.status;return r}
    const s=decodeHtml(x.body),k=propertyKind(p.type);
    if(k==="maison")r.valuePerM2=matchNumberNear(s,/prix\s*\/\s*m²\s*des\s*maisons\s*([0-9\s.,]+)\s*€/i);
    else if(k==="appartement")r.valuePerM2=matchNumberNear(s,/prix\s*\/\s*m²\s*des\s*appartements\s*([0-9\s.,]+)\s*€/i);
    if(!r.valuePerM2)r.valuePerM2=matchNumberNear(s,/prix\s+(?:moyen|moyenne)[^0-9]{0,100}([0-9\s.,]+)\s*€\s*\/\s*m2/i);
    if(!r.valuePerM2 && p.department==="08"){
      const rx=new RegExp(slugify(p.city).replace(/-/g,"[\\s-]+")+"\\s*\\(\\s*"+p.postalCode+"\\s*\\)\\s*([0-9\s.,]+)\\s*€\\s*([0-9\s.,]+)\\s*€","i");
      const m=rx.exec(s);if(m)r.valuePerM2=num(p.type.toLowerCase().includes("appart")?m[1]:m[2]);
    }
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="PAP · repère prix/m² public"}else r.status="form_only";
    return finalize(r,p)
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

function selogerUrl(p){
  const city=slugify(p.city),code=String(p.cityCode||"").replace(/^0/,""),dep=p.department==="08"?"ardennes":slugify(p.departmentName||"");
  if(!city||!code||!dep)return "";
  return "https://www.seloger.com/prix-de-l-immo/vente/"+(p.regionSlug||"champagne-ardenne")+"/"+(p.departmentSlug||dep)+"/"+city+"/"+code+".htm";
}
async function seloger(p){
  const url=selogerUrl(p),r=baseResult("seloger","SeLoger",url||"https://www.seloger.com/estimation-immobiliere.html");
  if(!url){r.status="missing_location";return r}
  try{
    const x=await fetchHtml(url);if(!x.ok){r.status="http_"+x.status;return r}
    const s=decodeHtml(x.body),k=propertyKind(p.type);
    r.valuePerM2=k==="maison"?matchNumberNear(s,/prix moyen des maisons au m2[^0-9]{0,100}([0-9\s.,]+)\s*€/i):k==="appartement"?matchNumberNear(s,/prix moyen des appartements au m2[^0-9]{0,100}([0-9\s.,]+)\s*€/i):matchNumberNear(s,/prix moyen au m2[^0-9]{0,100}([0-9\s.,]+)\s*€/i);
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="SeLoger · prix public de la ville"}else r.status="form_only";
    return finalize(r,p)
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

async function meilleursAgents(p){
  const url="https://www.meilleursagents.com/prix-immobilier/"+slugify(p.city)+(p.postalCode?"-"+p.postalCode:"")+"/",r=baseResult("meilleurs-agents","Meilleurs Agents",url);
  try{
    const x=await fetchHtml(url);if(!x.ok){r.status="http_"+x.status;return r}
    const s=decodeHtml(x.body),k=propertyKind(p.type);
    const section=k==="maison"?s.match(/Prix des maisons[\s\S]{0,220}?Prix m² moyen[\s\S]{0,80}?([0-9\s.,]+)\s*€/i):k==="appartement"?s.match(/Prix des appartements[\s\S]{0,220}?Prix m² moyen[\s\S]{0,80}?([0-9\s.,]+)\s*€/i):null;
    const top=k==="maison"?s.match(/Maison[\s\S]{0,120}?Prix m2 moyen[\s\S]{0,50}?([0-9\s.,]+)\s*€/i):k==="appartement"?s.match(/Appartement[\s\S]{0,120}?Prix m2 moyen[\s\S]{0,50}?([0-9\s.,]+)\s*€/i):null;
    r.valuePerM2=section?num(section[1]):top?num(top[1]):null;
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="Meilleurs Agents · prix m² public"}else r.status="form_only";
    return finalize(r,p)
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

async function century21(p){
  const map={"08":["grand-est","ardennes"],"51":["grand-est","marne"],"10":["grand-est","aube"],"54":["grand-est","meurthe-et-moselle"],"55":["grand-est","meuse"],"52":["grand-est","haute-marne"],"59":["hauts-de-france","nord"],"62":["hauts-de-france","pas-de-calais"]};
  const a=map[p.department],city=String(p.city||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g,"+");
  const url=a?"https://www.century21.fr/prix-m2-immobilier/"+a[0]+"/"+a[1]+"/"+city+"/":"https://www.century21.fr/estimation-immobiliere";
  const r=baseResult("century21","CENTURY 21",url);if(!a){r.status="unsupported_department";return r}
  try{
    const x=await fetchHtml(url);if(!x.ok){r.status="http_"+x.status;return r}
    const s=decodeHtml(x.body),k=propertyKind(p.type);
    const m=k==="maison"?/Pour les maisons,[\s\S]{0,180}?compris entre ([0-9\s.,]+)\s*€\s+et ([0-9\s.,]+)\s*€/i:k==="appartement"?/Pour les appartements,[\s\S]{0,180}?compris entre ([0-9\s.,]+)\s*€\s+et ([0-9\s.,]+)\s*€/i:null;
    const z=m?s.match(m):null;
    if(z){r.lowPerM2=num(z[1]);r.highPerM2=num(z[2]);r.valuePerM2=Math.round((r.lowPerM2+r.highPerM2)/2);r.status="ok";r.confidence="fourchette";r.method="CENTURY 21 · milieu de fourchette publique ETALAB"}else r.status="range_only";
    return finalize(r,p)
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

async function orpi(p){
  const url="https://www.orpi.com/prix-immobilier/"+slugify(p.city),r=baseResult("orpi","Orpi",url);
  try{
    const x=await fetchHtml(url);if(!x.ok){r.status="http_"+x.status;return r}
    const s=decodeHtml(x.body),k=propertyKind(p.type);
    r.valuePerM2=k==="maison"?matchNumberNear(s,/Maison\s+([0-9\s.,]+)\s*€\s*\/\s*m²/i):k==="appartement"?matchNumberNear(s,/Appartement\s+([0-9\s.,]+)\s*€\s*\/\s*m²/i):null;
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="Orpi · prix de vente moyen public"}else r.status="not_found";
    return finalize(r,p)
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

async function laforet(p){
  const r=baseResult("laforet","Laforêt","https://www.laforet.com/estimer");
  try{const x=await fetchHtml(r.url);if(/captcha|recaptcha|hcaptcha|challenge/i.test(x.body)){r.status="captcha";r.error="CAPTCHA détecté — arrêt volontaire, aucun contournement."}else{r.status="form_only";r.method="Laforêt · formulaire public; aucune soumission automatique si protection présente"}return r}catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r}
}

async function runEstimateurSources(input={}) {
  const normalized={
    city:String(input.city||"").trim(),
    postalCode:String(input.postalCode||"").trim(),
    cityCode:String(input.cityCode||"").trim(),
    department:String(input.department||String(input.postalCode||"").slice(0,2)).trim(),
    departmentName:String(input.departmentName||"").trim(),
    departmentSlug:String(input.departmentSlug||"").trim(),
    regionSlug:String(input.regionSlug||"").trim(),
    type:String(input.type||"Maison").trim(),
    area:Number(input.area)||0,
    rooms:Number(input.rooms)||0
  };
  if(!normalized.city)throw new Error("Commune manquante pour les adaptateurs d'estimation.");
  const adapters=[pap,seloger,meilleursAgents,century21,orpi,laforet];
  const settled=await Promise.all(adapters.map(fn=>fn(normalized).catch(error=>({id:fn.name,status:"error",error:error.message}))));
  const successful=settled.filter(x=>x.status==="ok"&&Number.isFinite(x.valuePerM2)&&x.valuePerM2>0);
  const values=successful.map(x=>x.valuePerM2).sort((a,b)=>a-b);
  const median=values.length?values[Math.floor(values.length/2)]:null;
  const average=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null;
  const estimatedValue=average&&normalized.area?Math.round(average*normalized.area):null;
  return {
    property:normalized,
    sources:settled,
    summary:{
      successfulCount:successful.length,
      totalCount:settled.length,
      medianPerM2:median,
      averagePerM2:average,
      estimatedValue,
      rangeLowPerM2:successful.length?Math.min(...successful.map(x=>x.lowPerM2||x.valuePerM2)):null,
      rangeHighPerM2:successful.length?Math.max(...successful.map(x=>x.highPerM2||x.valuePerM2)):null,
      disclaimer:"Repère automatisé construit à partir des données publiques de chaque site. Il ne remplace pas l'estimation personnalisée du site ni un avis de valeur professionnel."
    }
  };
}

module.exports={runEstimateurSources};
