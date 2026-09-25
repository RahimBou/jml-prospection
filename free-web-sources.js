const DEFAULT_SOURCES = [
  {id:"bayardhabitat",label:"Bayard Habitat",base:"https://www.bayardhabitat.fr/"},
  {id:"rimbaudimmo",label:"Rimbaud Immo",base:"https://www.rimbaudimmo.fr/"},
  {id:"ingimmobilier",label:"ING Immobilier",base:"https://www.agence-ing.fr/"},
  {id:"illimmobilier",label:"ILL Immobilier",base:"https://www.ill-immobilier.fr/"},
  {id:"justimmo08",label:"Justimmo08",base:"https://www.justimmo08.fr/"},
  {id:"toutabitat",label:"Toutabitat",base:"https://www.toutabitat.com/"},
  {id:"pergent",label:"Pergent Immobilier",base:"https://www.pergent-immobilier.com/"},
  {id:"fischer",label:"Fischer Immobilier",base:"https://www.fischer-immobilier.fr/"},
  {id:"bressy",label:"Dany Bressy Immobilier",base:"https://www.bressy-immobilier.com/"}
];

const ROBOTS_CACHE = new Map();
const HTML_CACHE = new Map();

function clean(v){return String(v??"").replace(/\s+/g," ").trim()}
function norm(v){return clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function absUrl(href,base){
  try{
    const u=new URL(href,base);
    if(!/^https?:$/.test(u.protocol))return null;
    u.hash="";
    return u.toString();
  }catch{return null}
}
function sameOrigin(a,b){
  try{return new URL(a).hostname.replace(/^www\./,"")===new URL(b).hostname.replace(/^www\./,"")}catch{return false}
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function fetchText(url,timeout=9000){
  if(HTML_CACHE.has(url))return HTML_CACHE.get(url);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{"Accept":"text/html,application/xhtml+xml,application/xml,text/xml,*/*","User-Agent":"JML-Prospection-public/1.0"},signal:controller.signal});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const text=await r.text();
    HTML_CACHE.set(url,text);
    if(HTML_CACHE.size>500)HTML_CACHE.delete(HTML_CACHE.keys().next().value);
    return text;
  }finally{clearTimeout(timer)}
}

function parseRobots(text){
  const lines=String(text||"").split(/\r?\n/),groups=[];let current=null;
  for(const raw of lines){
    const line=raw.split("#")[0].trim();
    if(!line)continue;
    const m=line.match(/^user-agent\s*:\s*(.+)$/i);
    if(m){current={agents:[m[1].trim().toLowerCase()],disallow:[]};groups.push(current);continue}
    if(/^disallow\s*:/i.test(line)&&current){
      const p=line.replace(/^disallow\s*:/i,"").trim();
      if(p)current.disallow.push(p);
    }
  }
  return groups.find(g=>g.agents.includes("*"))||null;
}
function pathMatchesRule(path,rule){
  if(!rule)return false;
  const escaped=String(rule).replace(/[.*+?^()|[\]\\]/g,"\\$&").replace(/\\\*/g,".*");
  try{return new RegExp("^"+escaped).test(path)}catch{return false}
}
async function robotsAllows(url){
  let u;try{u=new URL(url)}catch{return false}
  const origin=u.origin;
  if(!ROBOTS_CACHE.has(origin)){
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
      const r=await fetch(origin+"/robots.txt",{headers:{"User-Agent":"JML-Prospection-public/1.0"},signal:controller.signal});
      clearTimeout(timer);
      if(!r.ok){ROBOTS_CACHE.set(origin,{allow:false,reason:"robots.txt inaccessible"});return false}
      ROBOTS_CACHE.set(origin,{allow:true,rules:parseRobots(await r.text())});
    }catch{ROBOTS_CACHE.set(origin,{allow:false,reason:"robots.txt inaccessible"})}
  }
  const state=ROBOTS_CACHE.get(origin);
  if(!state.allow)return false;
  return !(state.rules?.disallow||[]).some(rule=>pathMatchesRule(u.pathname+u.search,rule));
}
function decodeHtml(s){
  return String(s||"").replace(/\s+/g," ")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").trim();
}
function stripHtml(html){
  return decodeHtml(String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<svg[\s\S]*?<\/svg>/gi," ").replace(/<[^>]+>/g," "));
}
function meta(html,name){
  const escaped=String(name).replace(/[.*+?^()|[\]\\]/g,"\\$&");
  const re=new RegExp("<meta[^>]+(?:name|property)=[\"\']"+escaped+"[\"\'][^>]+content=[\"\']([^\"\']*)[\"\'][^>]*>","i");
  return decodeHtml((html.match(re)||[])[1]||"");
}
function extractLinks(html,base){
  const out=[],re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;let m;
  while((m=re.exec(html))&&out.length<250){
    const u=absUrl(m[1],base);if(u&&sameOrigin(u,base))out.push(u);
  }
  return [...new Set(out)];
}
function extractJsonLd(html){
  const out=[],re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=re.exec(html))){
    try{const x=JSON.parse(m[1].trim().replace(/<!--|-->/g,""));if(Array.isArray(x))out.push(...x);else out.push(x)}catch{}
  }
  return out;
}
function flattenJsonLd(x,out=[]){
  if(!x)return out;
  if(Array.isArray(x)){for(const v of x)flattenJsonLd(v,out);return out}
  if(typeof x==="object"){
    out.push(x);
    if(x["@graph"])flattenJsonLd(x["@graph"],out);
    if(x.item)flattenJsonLd(x.item,out);
    if(x.mainEntity)flattenJsonLd(x.mainEntity,out);
  }
  return out;
}
function firstNumber(v){
  if(typeof v==="number"&&Number.isFinite(v))return v;
  const m=String(v??"").replace(/\s/g,"").replace(",",".").match(/-?\d+(?:\.\d+)?/);
  return m?Number(m[0]):0;
}
function addressFromJson(x){
  const a=x?.address||x?.location?.address||x?.itemOffered?.address;
  if(typeof a==="string")return clean(a);
  if(a&&typeof a==="object")return clean([a.streetAddress,a.postalCode,a.addressLocality].filter(Boolean).join(", "));
  return "";
}
function extractItem(html,url,source){
  const title=meta(html,"og:title")||meta(html,"twitter:title"),description=meta(html,"og:description")||meta(html,"description");
  const data=flattenJsonLd(extractJsonLd(html));
  const candidates=data.filter(x=>{
    const t=String(x["@type"]||"").toLowerCase();
    return /realestate|residence|product|offer|singlefamily|apartment|house|land|property/.test(t)||x.offers||x.floorSize||x.numberOfRooms;
  });
  const x=candidates[0]||{},offer=Array.isArray(x.offers)?(x.offers[0]||{}):(x.offers||{});
  const area=firstNumber(x.floorSize?.value??x.floorSize??x.itemOffered?.floorSize?.value);
  const rooms=firstNumber(x.numberOfRooms??x.itemOffered?.numberOfRooms);
  const price=firstNumber(offer.price??x.price??x.itemOffered?.offers?.price);
  const address=addressFromJson(x)||addressFromJson(x.itemOffered);
  const city=clean(x.address?.addressLocality||x.location?.address?.addressLocality||x.itemOffered?.address?.addressLocality||"");
  const postal=clean(x.address?.postalCode||x.location?.address?.postalCode||x.itemOffered?.address?.postalCode||"");
  const name=clean(x.name||x.itemOffered?.name||title);
  const lower=norm(name+" "+description+" "+stripHtml(html).slice(0,12000));
  if(!/(vente|vendre|a vendre|acheter|achat|maison|appartement|immeuble|terrain|local commercial)/.test(lower))return null;
  if(!price&&!area&&!address&&!title)return null;
  return {
    reference:"",title:name||"Bien immobilier",description,price,surface:area,rooms,
    type:clean(x["@type"]||x.itemOffered?.["@type"]||""),city,postal_code:postal,address,
    latitude:Number(x.geo?.latitude||x.itemOffered?.geo?.latitude)||0,
    longitude:Number(x.geo?.longitude||x.itemOffered?.geo?.longitude)||0,
    external_url:url,source:"Web public · "+source,seller_type:"professionnel / annonce publique",
    dpe:clean(x.energyEfficiencyCategory||x.itemOffered?.energyEfficiencyCategory||""),
    published_at:clean(x.datePosted||x.datePublished||""),updated_at:clean(x.dateModified||""),
    sources:[{source,url,reference:""}]
  };
}
function candidateScore(url,q){
  const s=norm(url);let score=0;
  if(/vente|vendre|acheter|annonce|bien|maison|appartement|terrain|immeuble|commerce/.test(s))score+=5;
  if(q&&s.includes(norm(q).replace(/\s+/g,"-")))score+=2;
  if(/location|louer|rent/.test(s))score-=5;
  return score;
}
function isCataloguePage(item,html,url){
  const title=norm(item?.title||"");
  const text=norm((item?.title||"")+" "+(item?.description||"")+" "+String(html||"").slice(0,16000));
  const genericTitle=/^(annonces? immobili[eè]res?|vente de maisons? et villas?|vente de terrains?|vente d['’]appartements?|nos biens|nos annonces|biens immobiliers?|immobilier|acheter un bien|estimation|contact|accueil|recherche)/.test(title);
  let genericUrl=false;try{genericUrl=/\/(annonces?|biens?|immobilier|vente|acheter|recherche|estimation|contact|agence|nos-biens?)(\/|$)/i.test(new URL(url).pathname)}catch{}
  const hasSpecificData=Number(item?.price)>0||Number(item?.surface)>0||Boolean(item?.address)||Number(item?.rooms)>0;
  const listingWords=(text.match(/maison|appartement|terrain|immeuble|local commercial/g)||[]).length;
  return Boolean(item)&&(genericTitle||genericUrl)&&!hasSpecificData&&listingWords<5;
}
async function discoverSource(source,q){
  const stats={id:source.id,label:source.label,base:source.base,ok:false,count:0,blocked:false,error:null,checked:0};
  try{
    if(!(await robotsAllows(source.base))){stats.blocked=true;stats.error="Collecte désactivée par robots.txt ou robots inaccessible";return {stats,items:[]}}
    const home=await fetchText(source.base),links=extractLinks(home,source.base);
    const sitemapMatch=home.match(/<link[^>]+href=["']([^"']*sitemap[^"']*)["'][^>]*>/i);
    if(sitemapMatch?.[1]){
      const sm=absUrl(sitemapMatch[1],source.base);
      if(sm&&await robotsAllows(sm)){
        try{
          const xml=await fetchText(sm,8000);
          for(const m of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)){const u=absUrl(m[1],source.base);if(u&&sameOrigin(u,source.base))links.push(u);if(links.length>=350)break}
        }catch{}
      }
    }
    const unique=[...new Set(links)].filter(u=>!/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js)(\?|$)/i.test(u)).sort((a,b)=>candidateScore(b,q)-candidateScore(a,q)).slice(0,18);
    const items=[];
    for(const u of unique){
      if(items.length>=10)break;
      if(!(await robotsAllows(u)))continue;
      try{
        const html=await fetchText(u,8000);stats.checked++;
        let item=extractItem(html,u,source.label);
        if(item&&isCataloguePage(item,html,u)){
          const childLinks=extractLinks(html,u)
            .filter(v=>candidateScore(v,q)>0)
            .sort((a,b)=>candidateScore(b,q)-candidateScore(a,q))
            .slice(0,10);
          for(const child of childLinks){
            if(items.length>=10)break;
            if(!(await robotsAllows(child)))continue;
            try{
              const childHtml=await fetchText(child,8000);stats.checked++;
              const childItem=extractItem(childHtml,child,source.label);
              if(childItem&&!isCataloguePage(childItem,childHtml,child)){
                const cityNeedle=norm(q||"");
                if(cityNeedle&&childItem.city&&!norm(childItem.city).includes(cityNeedle)&&!norm(child).includes(cityNeedle))continue;
                items.push(childItem);
              }
            }catch{}
            await sleep(100);
          }
          item=null;
        }
        if(item&&!isCataloguePage(item,html,u)){
          const cityNeedle=norm(q||"");
          if(cityNeedle&&item.city&&!norm(item.city).includes(cityNeedle)&&!norm(u).includes(cityNeedle))continue;
          items.push(item);
        }
      }catch{}
      await sleep(120);
    }
    stats.ok=true;stats.count=items.length;return {stats,items};
  }catch(e){stats.error=e.message||"source inaccessible";return {stats,items:[]}}
}
async function discoverChercherTrouverPublic(q){
  const stats={id:"cherchertrouver-public",label:"ChercherTrouver.immo · pages publiques",base:"https://cherchertrouver.immo/",ok:false,count:0,blocked:false,error:null,checked:0};
  try{
    const cleanQ=clean(q||"");
    const slug=norm(cleanQ).replace(/\s+/g,"-");
    const pageUrl=slug
      ?"https://cherchertrouver.immo/villes/"+encodeURIComponent(slug)
      :"https://cherchertrouver.immo/departements/ardennes-08";
    if(!(await robotsAllows(pageUrl))){stats.blocked=true;stats.error="Collecte désactivée par robots.txt ou robots inaccessible";return {stats,items:[]}}
    const html=await fetchText(pageUrl,10000);
    const links=extractLinks(html,pageUrl)
      .filter(u=>/\/annonces\//i.test(new URL(u).pathname))
      .slice(0,35);
    const items=[];
    for(const u of [...new Set(links)]){
      if(items.length>=20)break;
      if(!(await robotsAllows(u)))continue;
      try{
        const itemHtml=await fetchText(u,9000);stats.checked++;
        const item=extractItem(itemHtml,u,"ChercherTrouver.immo · public");
        const lower=norm((item?.title||"")+" "+(item?.description||"")+" "+stripHtml(itemHtml).slice(0,12000));
        const rental=/location|louer|loyer|\bpar mois\b|€\/mois/.test(lower);
        if(item&&!rental&&Number(item.price)>0&&Number(item.surface)>0){
          item.source="ChercherTrouver.immo · public";
          item.sources=[{source:"ChercherTrouver.immo · public",reference:item.reference||"",url:u}];
          items.push(item);
        }
      }catch{}
      await sleep(100);
    }
    stats.ok=true;stats.count=items.length;
    return {stats,items};
  }catch(e){stats.error=e.message||"source inaccessible";return {stats,items:[]}}
}

async function searchFreeWebListings(params={}){
  const q=clean(params.ville||params.q||"");
  const maxSources=Math.max(1,Math.min(DEFAULT_SOURCES.length,Number(params.web_sources)||DEFAULT_SOURCES.length));
  const results=await Promise.all([
    discoverChercherTrouverPublic(q),
    ...DEFAULT_SOURCES.slice(0,maxSources).map(s=>discoverSource(s,q))
  ]);
  const items=results.flatMap(r=>r.items||[]);
  // Filtre final de sécurité : aucune page catalogue/générique ne doit remonter
  // même si son HTML/JSON-LD ressemble superficiellement à un bien.
  const propertyItems=items.filter(p=>{
    const title=norm(p.title||"");
    const url=String(p.external_url||"");
    const genericTitle=/^(annonces? immobili[eè]res?|vente de maisons? et villas?|vente de terrains?|vente d['’]appartements?|nos biens|nos annonces|biens immobiliers?|immobilier|acheter un bien|estimation|contact|accueil|recherche)/.test(title);
    const genericUrl=/\/(annonces?|biens?|immobilier|vente|acheter|recherche|estimation|contact|agence|nos-biens?)([-_a-z0-9]*)?(\/|$)/i.test((()=>{try{return new URL(url).pathname}catch{return url}})());
    const hasSpecificData=Number(p.price)>0||Number(p.surface)>0||Number(p.rooms)>0||Boolean(String(p.address||"").trim());
    return !(genericTitle||genericUrl)&&hasSpecificData;
  });
  const seen=new Set(),deduped=[];
  for(const p of propertyItems){
    const key=(p.external_url||"")+"|"+norm(p.address)+"|"+norm(p.city)+"|"+Number(p.price||0)+"|"+Number(p.surface||0);
    if(seen.has(key))continue;seen.add(key);deduped.push(p);
  }
  return {
    source:"JML Web public · sources autorisées",total:deduped.length,items:deduped,
    sources:results.map(r=>r.stats),
    policy:"Collecte limitée aux pages publiques de sources configurées, avec vérification robots.txt. Aucun contournement de CAPTCHA, authentification ou blocage."
  };
}
module.exports={DEFAULT_SOURCES,searchFreeWebListings};
