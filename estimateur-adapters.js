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

async function pap(input) {
  const slug=slugify(input.city||"");
  const postal=String(input.postalCode||"").trim();
  const url="https://www.pap.fr/vendeur/prix-m2/"+slug+(postal?"-"+postal:"");
  const r=baseResult("pap","PAP",url);
  try {
    const page=await fetchHtml(url);
    if(!page.ok){r.status="http_"+page.status;return r;}
    const h=page.body;
    const clean=text(h);
    const kind=propertyKind(input.type);
    const specific=kind==="maison"
      ? matchNumberNear(h,/prix\s*(?:moyen|moyenne)[^<]{0,180}?(?:des|de)\s*(?:maisons|villas)[^<]{0,100}?([\d\s.,]+)\s*€/i)
      : kind==="appartement"
        ? matchNumberNear(h,/prix\s*(?:moyen|moyenne)[^<]{0,180}?(?:des|d')\s*appartements[^<]{0,100}?([\d\s.,]+)\s*€/i)
        : null;
    const generic=matchNumberNear(h,/prix\s*(?:moyen|moyenne)[^<]{0,120}?([\d\s.,]+)\s*€\s*\/\s*m2/i)
      || matchNumberNear(h,/prix\s*(?:moyen|moyenne)[^<]{0,120}?([\d\s.,]+)\s*€/i);
    r.valuePerM2=specific||generic;
    const low=matchNumberNear(h,/prix\s*\+?bas[^<]{0,80}([\d\s.,]+)\s*€\s*\/\s*m2/i);
    const high=matchNumberNear(h,/prix\s*\+?haut[^<]{0,80}([\d\s.,]+)\s*€\s*\/\s*m2/i);
    r.lowPerM2=low;r.highPerM2=high;
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="PAP · prix au m² public (DVF + PAP)";}
    else if(/aucune adresse|estimation gratuite/i.test(clean))r.status="form_only";
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
}

function selogerUrl(input) {
  const city=slugify(input.city||"");
  const dept=String(input.department||"").trim();
  const code=String(input.cityCode||"").replace(/^0/,"");
  const region=(String(input.regionSlug||"").trim()||"champagne-ardenne");
  const departmentSlug=(String(input.departmentSlug||"").trim()||dept==="08"?"ardennes":slugify(input.departmentName||""));
  if(!city||!code||!departmentSlug)return "";
  return "https://www.seloger.com/prix-de-l-immo/vente/"+region+"/"+departmentSlug+"/"+city+"/"+code+".htm";
}

async function seloger(input) {
  const url=selogerUrl(input);
  const r=baseResult("seloger","SeLoger",url||"https://www.seloger.com/estimation-immobiliere.html");
  if(!url){r.status="missing_location";return r;}
  try {
    const page=await fetchHtml(url);
    if(!page.ok){r.status="http_"+page.status;return r;}
    const h=page.body;
    const kind=propertyKind(input.type);
    const clean=text(h);
    let specific=null;
    if(kind==="maison")specific=matchNumberNear(h,/prix\s+moyen\s+des\s+maisons[^<]{0,220}?([\d\s.,]+)\s*€/i);
    if(kind==="appartement")specific=matchNumberNear(h,/prix\s+moyen\s+des\s+appartements[^<]{0,220}?([\d\s.,]+)\s*€/i);
    const generic=matchNumberNear(h,/prix\s+moyen\s+au\s+m2[^<]{0,180}?([\d\s.,]+)\s*€/i)
      || matchNumberNear(h,/prix\s+moyen\s+au\s*m²[^<]{0,180}?([\d\s.,]+)\s*€/i);
    r.valuePerM2=specific||generic;
    r.lowPerM2=matchNumberNear(h,/prix\s+bas[^<]{0,120}?([\d\s.,]+)\s*€/i);
    r.highPerM2=matchNumberNear(h,/prix\s+haut[^<]{0,120}?([\d\s.,]+)\s*€/i);
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="SeLoger · carte publique des prix";}
    else if(/estimer mon bien|estimation immobilière/i.test(clean))r.status="form_only";
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
}

async function meilleursAgents(input) {
  const slug=slugify(input.city||"");
  const postal=String(input.postalCode||"").trim();
  const url="https://www.meilleursagents.com/prix-immobilier/"+slug+(postal?"-"+postal:"")+"/";
  const r=baseResult("meilleurs-agents","Meilleurs Agents",url);
  try {
    const page=await fetchHtml(url);
    if(!page.ok){r.status="http_"+page.status;return r;}
    const h=page.body;
    const kind=propertyKind(input.type);
    const specific=kind==="maison"
      ? matchNumberNear(h,/prix\s*m2\s*moyen[^<]{0,140}?maisons[^<]{0,120}?([\d\s.,]+)\s*€/i)
      : kind==="appartement"
        ? matchNumberNear(h,/prix\s*m2\s*moyen[^<]{0,140}?appartements[^<]{0,120}?([\d\s.,]+)\s*€/i)
        : null;
    const generic=matchNumberNear(h,/prix\s*m2\s*moyen[^<]{0,220}?([\d\s.,]+)\s*€/i);
    r.valuePerM2=specific||generic;
    const range=String(h).match(/95%[^<]{0,200}?([\d\s.,]+)\s*€[^<]{0,80}?([\d\s.,]+)\s*€/i);
    if(range){r.lowPerM2=numberFromText(range[1]);r.highPerM2=numberFromText(range[2]);}
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="Meilleurs Agents · prix m² public (données MA + publiques)";}
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
}

async function century21(input) {
  const dept=String(input.department||"").trim();
  const slug=slugify(input.city||"");
  const deptMap={
    "08":{region:"grand-est",department:"ardennes"},
    "51":{region:"grand-est",department:"marne"},
    "10":{region:"grand-est",department:"aube"},
    "54":{region:"grand-est",department:"meurthe-et-moselle"},
    "55":{region:"grand-est",department:"meuse"},
    "52":{region:"grand-est",department:"haute-marne"},
    "59":{region:"hauts-de-france",department:"nord"},
    "62":{region:"hauts-de-france",department:"pas-de-calais"}
  };
  const area=deptMap[dept];
  const centurySlug=String(input.city||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").trim().replace(/\\s+/g,"+");
  const url=area
    ?"https://www.century21.fr/prix-m2-immobilier/"+area.region+"/"+area.department+"/"+centurySlug+"/"
    :"";
  const r=baseResult("century21","CENTURY 21",url||"https://www.century21.fr/estimation-immobiliere");
  if(!url){r.status="unsupported_department";return r;}
  try {
    const page=await fetchHtml(url);
    if(!page.ok){r.status="http_"+page.status;return r;}
    const h=page.body;
    const kind=propertyKind(input.type);
    const range=kind==="maison"
      ? String(h).match(/maisons[^<]{0,300}?([\d\s.,]+)\s*€[^<]{0,100}?([\d\s.,]+)\s*€\s*par\s*m²/i)
      : kind==="appartement"
        ? String(h).match(/appartements[^<]{0,300}?([\d\s.,]+)\s*€[^<]{0,100}?([\d\s.,]+)\s*€\s*par\s*m²/i)
        : null;
    if(range){
      r.lowPerM2=numberFromText(range[1]);r.highPerM2=numberFromText(range[2]);
      if(r.lowPerM2&&r.highPerM2){r.valuePerM2=Math.round((r.lowPerM2+r.highPerM2)/2);r.status="ok";r.confidence="fourchette";r.method="CENTURY 21 · fourchette publique ETALAB, milieu de fourchette";}
    } else {
      const generic=String(h).match(/prix[^<]{0,80}?varient de\s*([\d\s.,]+)\s*€[^<]{0,80}?à\s*([\d\s.,]+)\s*€\s*par\s*m²/i);
      if(generic){r.lowPerM2=numberFromText(generic[1]);r.highPerM2=numberFromText(generic[2]);r.status="range_only";}
    }
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
}

async function orpi(input) {
  const slug=slugify(input.city||"");
  const url="https://www.orpi.com/prix-immobilier/"+slug;
  const r=baseResult("orpi","Orpi",url);
  try {
    const page=await fetchHtml(url);
    if(!page.ok){r.status="http_"+page.status;return r;}
    const h=page.body;
    const kind=propertyKind(input.type);
    const specific=kind==="maison"
      ? matchNumberNear(h,/Maison\s+([\d\s.,]+)\s*€\s*\/\s*m²/i)
      : kind==="appartement"
        ? matchNumberNear(h,/Appartement\s+([\d\s.,]+)\s*€\s*\/\s*m²/i)
        : null;
    const generic=matchNumberNear(h,/prix\s+de\s+vente\s+moyen[^<]{0,120}?([\d\s.,]+)\s*€/i);
    r.valuePerM2=specific||generic;
    if(r.valuePerM2){r.status="ok";r.confidence="ville";r.method="Orpi · prix de vente moyen public";}
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
}

async function laforet(input) {
  const r=baseResult("laforet","Laforêt","https://www.laforet.com/estimer");
  try {
    const page=await fetchHtml(r.url);
    const h=page.body||"";
    if(/captcha|recaptcha|hcaptcha|challenge/i.test(h)){
      r.status="captcha";r.error="CAPTCHA détecté — arrêt volontaire, aucun contournement.";
    } else {
      r.status="form_only";r.method="Laforêt · formulaire d'estimation en ligne; extraction interactive non activée sans navigateur";
    }
    return finalize(r,input);
  }catch(e){r.status=e.name==="AbortError"?"timeout":"error";r.error=e.message;return r;}
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
