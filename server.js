const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines";
const DVF_URL = "https://apidf-preprod.cerema.fr/dvf_opendata/mutations/";
const DVF_GEO_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const DVF_GEO_LATEST_YEAR = 2025;
const dvfGeoCache = new Map();
const DVF_LOCAL_FILE = path.join(ROOT,"data","dvf_ardennes.csv.gz");
let dvfLocalCache = null;
const ADDRESS_URL = "https://api-adresse.data.gouv.fr/search/";
const { analyze: analyzeDataQuality } = require("./data-agent");

const MIME = {
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".png":"image/png",
  ".jpg":"image/jpeg",
  ".ico":"image/x-icon"
};

function send(res,status,data,type="application/json"){
  res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store"});
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function cleanLimit(value,max=50){const n=Number(value);return Number.isFinite(n)?Math.max(1,Math.min(max,Math.floor(n))):20}
async function jsonFetch(url){
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"JML-Prospection/1.0"},signal:controller.signal});
      const text=await r.text();
      let data;
      try{data=JSON.parse(text)}catch{data={raw:text}}
      if(!r.ok) throw new Error("Source HTTP "+r.status);
      return data;
    }catch(e){
      lastError=e;
      if(attempt<3) await new Promise(resolve=>setTimeout(resolve,700*attempt));
    }finally{clearTimeout(timer)}
  }
  throw new Error("Source inaccessible après 3 tentatives : "+(lastError?.message||"connexion impossible"));
}
async function binaryFetch(url){
  let lastError;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch(url,{headers:{"User-Agent":"JML-Prospection/1.0","Accept":"text/csv,application/gzip,*/*"},signal:controller.signal});
      if(!r.ok) throw new Error("Source HTTP "+r.status);
      return Buffer.from(await r.arrayBuffer());
    }catch(e){
      lastError=e;
      if(attempt<2) await new Promise(resolve=>setTimeout(resolve,800));
    }finally{clearTimeout(timer)}
  }
  throw new Error("Fichier DVF data.gouv inaccessible : "+(lastError?.message||"connexion impossible"));
}
function first(obj,keys){for(const k of keys){if(obj?.[k]!==undefined&&obj?.[k]!==null&&obj[k]!=="")return obj[k]}return ""}
function norm(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[’']/g," ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function normalizeDpe(x){
  return {
    dpeNumber:first(x,["numero_dpe","N°DPE","Numero_DPE","N°DPE_(CSTB)"]),
    address:first(x,["adresse_ban","Adresse_brute","Adresse_(BAN)","Adresse_BAN"]),
    addressNumber:first(x,["numero_voie_ban","Numero_voie_BAN","numero_voie","Numero_voie"]),
    street:first(x,["nom_voie_ban","Nom_voie_BAN","nom_voie","Nom_voie"]),
    postalCode:first(x,["code_postal_ban","Code_postal_(BAN)","Code_postal"]),
    city:first(x,["nom_commune_ban","Nom_commune_(BAN)","Nom_commune"]),
    cityCode:first(x,["code_insee_ban","Code_INSEE_(BAN)","Code_INSEE"]),
    longitude:Number(first(x,["longitude","lon","ban_longitude","Longitude"]))||0,
    latitude:Number(first(x,["latitude","lat","ban_latitude","Latitude"]))||0,
    coordX:Number(first(x,["ban_x","x","coord_x","Coordonnée_x"]))||0,
    coordY:Number(first(x,["ban_y","y","coord_y","Coordonnée_y"]))||0,
    area:Number(first(x,["Surface_habitable_logement","surface_habitable_logement","surface_habitable_immeuble","Surface_habitable_immeuble","Surface_habitable"]))||0,
    areaKind:"habitable",
    surfaceHabitable:Number(first(x,["Surface_habitable_logement","surface_habitable_logement","surface_habitable_immeuble","Surface_habitable_immeuble","Surface_habitable"]))||0,
    dpe:first(x,["etiquette_dpe","Etiquette_DPE","Etiquette_DPE_(à_date)","Etiquette_DPE_logement"]),
    buildingType:first(x,["type_batiment","Type_bâtiment","Type_bâtiment_(DPE)","type_batiment_dpe"]),
    energyConsumption:Number(first(x,["consommation_energie","Consommation_energie","Consommation_énergie"]))||0,
    gesValue:Number(first(x,["emission_ges","estimation_ges","Estimation_GES","emission_ges_logement"]))||0,
    constructionYear:Number(first(x,["annee_construction","Annee_construction","Année_construction"]))||0,
    rooms:Number(first(x,["nombre_pieces_principales","Nombre_pièces_principales","Nombre de pièces principales"]))||0,
    ges:first(x,["etiquette_ges","Etiquette_GES","Etiquette_GES_logement"]),
    date:first(x,["date_visite_diagnostiqueur","Date_établissement_DPE","Date_établissement","date_etablissement_dpe"]),
    source:"DPE ADEME"
  };
}
function parseCsvLine(line){
  const cells=[];let cell="",quote=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(quote&&line[i+1]==='"'){cell+='"';i++}else quote=!quote;
    }else if(c===','&&!quote){cells.push(cell);cell=""}else cell+=c;
  }
  cells.push(cell);
  return cells;
}
function parseDvfGeoCsv(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);
  if(!lines.length)return[];
  const headers=parseCsvLine(lines[0]),rows=[];
  for(let i=1;i<lines.length;i++){
    const cells=parseCsvLine(lines[i]),o={};
    for(let j=0;j<headers.length;j++)o[headers[j]]=cells[j]??"";
    rows.push(o);
  }
  return rows;
}
async function getLocalDvfArdennes(){
  if(dvfLocalCache)return dvfLocalCache;
  if(!fs.existsSync(DVF_LOCAL_FILE))return null;
  const zlib=require("node:zlib");
  const gz=fs.readFileSync(DVF_LOCAL_FILE);
  const text=zlib.gunzipSync(gz).toString("utf8");
  dvfLocalCache=parseDvfGeoCsv(text);
  return dvfLocalCache;
}
async function dvfLocalOpenData({codeInsee,yearMin,yearMax,limit}){
  const rows=await getLocalDvfArdennes();
  if(!rows)return null;
  const min=String(yearMin||"2021"),max=String(yearMax||String(DVF_GEO_LATEST_YEAR));
  return rows.filter(x=>String(x.code_commune||"")===String(codeInsee)&&String(x.date_mutation||"").slice(0,4)>=min&&String(x.date_mutation||"").slice(0,4)<=max)
    .sort((a,b)=>String(b.date_mutation||"").localeCompare(String(a.date_mutation||""))).slice(0,limit);
}
async function getDvfGeoCommune(codeInsee,year){
  const department=String(codeInsee).slice(0,2);
  const key="commune-"+codeInsee+"-"+year;
  if(dvfGeoCache.has(key))return dvfGeoCache.get(key);
  const url=DVF_GEO_BASE+"/"+year+"/communes/"+department+"/"+codeInsee+".csv";
  const text=await binaryFetch(url).then(b=>b.toString("utf8"));
  const rows=parseDvfGeoCsv(text);
  dvfGeoCache.set(key,rows);
  if(dvfGeoCache.size>24)dvfGeoCache.delete(dvfGeoCache.keys().next().value);
  return rows;
}
async function getDvfGeoDepartment(department,year){
  const key="department-"+department+"-"+year;
  if(dvfGeoCache.has(key))return dvfGeoCache.get(key);
  const url=DVF_GEO_BASE+"/"+year+"/departements/"+department+".csv.gz";
  const gz=await binaryFetch(url);
  const text=require("node:zlib").gunzipSync(gz).toString("utf8");
  const rows=parseDvfGeoCsv(text);
  dvfGeoCache.set(key,rows);
  if(dvfGeoCache.size>24)dvfGeoCache.delete(dvfGeoCache.keys().next().value);
  return rows;
}
async function dvfGeoOpenData({codeInsee,yearMin,yearMax,limit}){
  const department=String(codeInsee).slice(0,2);
  const min=Math.max(2021,Number(yearMin)||DVF_GEO_LATEST_YEAR-4);
  const max=Math.min(DVF_GEO_LATEST_YEAR,Number(yearMax)||DVF_GEO_LATEST_YEAR);
  const all=[];
  for(let year=min;year<=max;year++){
    try{
      const rows=await getDvfGeoCommune(codeInsee,year);
      all.push(...rows);
    }catch(communeError){
      const rows=await getDvfGeoDepartment(department,year);
      for(const x of rows)if(String(x.code_commune||"")===String(codeInsee))all.push(x);
    }
  }
  all.sort((a,b)=>String(b.date_mutation||"").localeCompare(String(a.date_mutation||"")));
  return all.slice(0,limit);
}
function normalizeDvf(x){
  return {
    mutationId:first(x,["idmutation","idopendata","id_mutation"]),
    date:first(x,["datemut","date_mutation"]),
    year:first(x,["anneemut","annee_mutation"]),
    value:Number(first(x,["valeurfonc","valeur_fonciere"]))||0,
    typeCode:first(x,["codtypbien","code_type_bien"]),
    type:first(x,["libtypbien","lib_type_bien"]),
    builtArea:Number(first(x,["sbati","surface_batie"]))||0,
    builtAreaKind:"built",
    landArea:Number(first(x,["sterr","surface_terrain"]))||0,
    landAreaKind:"land",
    cityCode:first(x,["codcomm","code_commune","l_codinsee"]),
    department:first(x,["coddep","code_departement"]),
    address:first(x,["adresse","l_adresse"]) || [first(x,["adresse_numero","numero_voie"]),first(x,["adresse_nom_voie","nom_voie"])]
      .filter(Boolean).join(" "),
    addressNumber:first(x,["adresse_numero","numero_voie","numvoie"]),
    street:first(x,["adresse_nom_voie","nom_voie"]),
    postalCode:first(x,["codepostal","code_postal"]),
    longitude:Number(first(x,["longitude","lon","ban_longitude","Longitude"]))||0,
    latitude:Number(first(x,["latitude","lat","ban_latitude","Latitude"]))||0,
    coordX:Number(first(x,["ff_x_4326","x","coord_x","ff_x"]))||0,
    coordY:Number(first(x,["ff_y_4326","y","coord_y","ff_y"]))||0,
    geom:first(x,["geomloc","geom_loc","geometry","ban_geom"]),
    rooms:Number(first(x,["nbpiece","nombre_pieces_principales"]))||0,
    source:"DVF+ Cerema"
  };
}
function parseGeomPoint(value){
  if(value===undefined||value===null||value==="")return null;
  if(typeof value==="object"){
    const coords=value?.coordinates;
    if(Array.isArray(coords)&&coords.length>=2&&Number.isFinite(Number(coords[0]))&&Number.isFinite(Number(coords[1])))return {kind:"lonlat",x:Number(coords[0]),y:Number(coords[1])};
    if(Number.isFinite(Number(value?.x))&&Number.isFinite(Number(value?.y)))return {kind:"xy",x:Number(value.x),y:Number(value.y)};
  }
  const str=String(value).trim();
  try{return parseGeomPoint(JSON.parse(str))}catch{}
  const m=str.match(/-?\d+(?:\.\d+)?/g);
  return m&&m.length>=2?{kind:"lonlat",x:Number(m[0]),y:Number(m[1])}:null;
}
function pointOf(item){
  const lon=Number(item?.longitude),lat=Number(item?.latitude);
  if(Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90&&(lon!==0||lat!==0))return {kind:"lonlat",x:lon,y:lat};
  const geom=parseGeomPoint(item?.geom); if(geom)return geom;
  const x=Number(item?.coordX),y=Number(item?.coordY);
  if(Number.isFinite(x)&&Number.isFinite(y)&&(x!==0||y!==0))return {kind:"xy",x,y};
  return null;
}
function distanceMeters(a,b){
  if(!a||!b||a.kind!==b.kind)return null;
  if(a.kind==="lonlat"){
    const R=6371000,rad=Math.PI/180,p1=a.y*rad,p2=b.y*rad,dp=(b.y-a.y)*rad,dl=(b.x-a.x)*rad;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  return Math.hypot(a.x-b.x,a.y-b.y);
}
function canonicalStreet(value){
  let s=norm(value);
  const replacements=[
    [/^av\s+/,"avenue "],[/\bav\b/g,"avenue"],[/^bd\s+/,"boulevard "],[/\bbd\b/g,"boulevard"],
    [/^r\s+/,"rue "],[/\br\b/g,"rue"],[/^pl\s+/,"place "],[/\bpl\b/g,"place"],
    [/^imp\s+/,"impasse "],[/\bimp\b/g,"impasse"],[/^che\s+/,"chemin "],[/\bche\b/g,"chemin"],
    [/^all\s+/,"allee "],[/\ball\b/g,"allee"]
  ];
  for(const [re,val] of replacements)s=s.replace(re,val);
  return s.replace(/\s+/g," ").trim();
}
function canonicalNumber(value){
  const s=norm(value);
  const m=s.match(/^0*(\d+[a-z]?(?:[-/]\d+[a-z]?)?)$/);
  return m?m[1]:s;
}
function addressParts(item){
  const address=String(item?.address||"");
  const postal=norm(item?.postalCode||"");
  const cityCode=norm(item?.cityCode||"");
  const city=norm(item?.city||"");
  const rawNumber=item?.addressNumber||((address.match(/^\s*(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)/)||[])[1]||"");
  const number=canonicalNumber(rawNumber);
  let street=String(item?.street||"");
  if(!street){
    street=address.replace(/^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s*/,"");
    let streetNorm=norm(street);
    if(postal){
      const pi=streetNorm.lastIndexOf(postal);
      if(pi>=0)street=street.slice(0,pi);
    }
    streetNorm=norm(street);
    if(city){
      const ci=streetNorm.lastIndexOf(city);
      if(ci>=0 && ci+city.length===streetNorm.length)street=street.slice(0,ci);
    }
  }
  street=canonicalStreet(street);
  const numberStreet=number&&street?number+"|"+street:"";
  const streetCity=street&&(cityCode||city)?(cityCode||city)+"|"+street:"";
  const streetPostal=street&&postal?postal+"|"+street:"";
  const fullAddress=number&&street?number+"|"+street:"";
  return {number,street,postal,cityCode,city,numberStreet,streetCity,streetPostal,fullAddress,point:pointOf(item)};
}
function buildDvfIndexes(rows){
  const numberStreet=new Map(),streetCity=new Map(),streetPostal=new Map(),postal=new Map(),fullAddress=new Map(),streetOnly=new Map(),geo=[];
  const add=(map,key,tx)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(tx)};
  for(const tx of rows){
    const p=addressParts(tx);
    add(numberStreet,p.numberStreet,tx);add(streetCity,p.streetCity,tx);add(streetPostal,p.streetPostal,tx);add(postal,p.postal,tx);add(fullAddress,p.fullAddress,tx);add(streetOnly,p.street,tx);
    if(p.point)geo.push({tx,point:p.point});
  }
  return {numberStreet,streetCity,streetPostal,postal,fullAddress,streetOnly,geo};
}
function findDvfMatches(property,indexes){
  const p=addressParts(property);
  const sameCommune=tx=>{
    const t=addressParts(tx);
    return (p.cityCode&&t.cityCode&&p.cityCode===t.cityCode)||(p.postal&&t.postal&&p.postal===t.postal);
  };
  const unique=arr=>Array.from(new Map((arr||[]).map(tx=>[tx.mutationId||String(tx.date||"")+"|"+String(tx.address||""),tx])).values());
  const postalTxs=unique(indexes.postal.get(p.postal)||[]);
  const postalCount=postalTxs.length;
  let candidates=unique(indexes.fullAddress.get(p.fullAddress)||[]).filter(sameCommune);
  if(candidates.length)return {txs:candidates,matchQuality:"exact",matchReason:"Adresse normalisée + commune/CP",distanceMeters:null,postalCount};
  candidates=unique(indexes.numberStreet.get(p.numberStreet)||[]).filter(sameCommune);
  if(candidates.length)return {txs:candidates,matchQuality:"exact",matchReason:"Numéro + rue + commune/CP",distanceMeters:null,postalCount};
  candidates=unique([...(indexes.streetCity.get(p.streetCity)||[]),...(indexes.streetPostal.get(p.streetPostal)||[])]).filter(sameCommune);
  if(candidates.length)return {txs:candidates,matchQuality:"street",matchReason:"Rue + commune/CP",distanceMeters:null,postalCount};
  if(p.street){
    const streetCandidates=unique(indexes.streetOnly.get(p.street)||[]).filter(tx=>{
      const t=addressParts(tx);
      return (p.cityCode&&t.cityCode&&p.cityCode===t.cityCode)||(p.postal&&t.postal&&p.postal===t.postal)||(!p.cityCode&&!p.postal);
    });
    if(streetCandidates.length&&streetCandidates.length<=10)return {txs:streetCandidates,matchQuality:"street",matchReason:"Même rue · commune/CP partiel",distanceMeters:null,postalCount};
  }
  if(postalCount>0&&postalCount<=5)return {txs:postalTxs,matchQuality:"postal",matchReason:"Code postal seul (échantillon ≤ 5)",distanceMeters:null,postalCount};
  if(p.point){
    let nearest=null;
    for(const g of indexes.geo){
      const d=distanceMeters(p.point,g.point);
      if(d!==null&&d<=80&&(!nearest||d<nearest.distanceMeters))nearest={tx:g.tx,distanceMeters:d};
    }
    if(nearest)return {txs:[nearest.tx],matchQuality:"proximity",matchReason:"Proximité géographique ≤ 80 m",distanceMeters:Math.round(nearest.distanceMeters),postalCount};
  }
  return {txs:[],matchQuality:"none",matchReason:"Aucune correspondance fiable",distanceMeters:null,postalCount};
}
async function resolveCommune(query){
  if(!query) return null;
  try{
    const u=new URL(ADDRESS_URL);
    u.searchParams.set("q",query);
    u.searchParams.set("type","municipality");
    u.searchParams.set("limit","1");
    const data=await jsonFetch(u);
    const f=data?.features?.[0];
    if(f) return {city:f.properties?.city||f.properties?.label||"",cityCode:f.properties?.citycode||"",postalCode:f.properties?.postcode||"",label:f.properties?.label||""};
  }catch(e){}
  try{
    const u=new URL(DPE_URL);
    u.searchParams.set("q",query);
    u.searchParams.set("size","5");
    const data=await jsonFetch(u);
    const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[];
    const p=rows.map(normalizeDpe).find(x=>x.cityCode||x.city);
    if(p) return {city:p.city||query,cityCode:p.cityCode||"",postalCode:p.postalCode||"",label:p.address||p.city||query};
  }catch(e){}
  const known={
    "charleville-mézières":{city:"Charleville-Mézières",cityCode:"08105",postalCode:"08000"},
    "charleville mezieres":{city:"Charleville-Mézières",cityCode:"08105",postalCode:"08000"},
    "sedan":{city:"Sedan",cityCode:"08409",postalCode:"08200"},
    "rethel":{city:"Rethel",cityCode:"08362",postalCode:"08300"},
    "revin":{city:"Revin",cityCode:"08363",postalCode:"08500"},
    "givet":{city:"Givet",cityCode:"08190",postalCode:"08600"},
    "vouziers":{city:"Vouziers",cityCode:"08490",postalCode:"08400"}
  };
  return known[norm(query)]||null;
}
async function api(pathname,url){
  if(pathname==="/api/health") return {ok:true,sources:{dpe:"ADEME",dvf:"DVF+ Cerema",geocoding:"API Adresse"},server:"jml-prospection",version:"1.10.7"};
  if(pathname==="/api/data-agent"){
    let codeInsee=url.searchParams.get("codeInsee")?.trim();
    const q=url.searchParams.get("q")?.trim();
    if(!codeInsee&&q){const cc=await resolveCommune(q);codeInsee=cc?.cityCode||""}
    if(!codeInsee)throw new Error("Commune introuvable : indique une commune ou un code INSEE");
    const limit=cleanLimit(url.searchParams.get("limit"),100);
    const dpeUrl=new URL(DPE_URL);
    dpeUrl.searchParams.set("code_insee_ban_eq",codeInsee);
    dpeUrl.searchParams.set("size",String(Math.min(100,limit)));
    const [dpeResult,dvfResult]=await Promise.allSettled([
      jsonFetch(dpeUrl),
      (async()=>{
        try{
          const u=new URL(DVF_URL);u.searchParams.set("code_insee",codeInsee);u.searchParams.set("page_size","500");u.searchParams.set("anneemut_min",String(Math.max(2021,DVF_GEO_LATEST_YEAR-4)));u.searchParams.set("anneemut_max",String(DVF_GEO_LATEST_YEAR));
          const data=await jsonFetch(u);const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
          return {source:"DVF+ Cerema",rows:rows.map(normalizeDvf),fallback:false};
        }catch(e){
          const rows=await dvfGeoOpenData({codeInsee,yearMin:String(Math.max(2021,DVF_GEO_LATEST_YEAR-4)),yearMax:String(DVF_GEO_LATEST_YEAR),limit:500});
          return {source:"DVF open-data · data.gouv.fr",rows:rows.map(x=>normalizeDvf({id_mutation:first(x,["id_mutation"]),date_mutation:first(x,["date_mutation"]),valeur_fonciere:first(x,["valeur_fonciere"]),code_type_local:first(x,["code_type_local"]),type_local:first(x,["type_local"]),surface_reelle_bati:first(x,["surface_reelle_bati"]),surface_terrain:first(x,["surface_terrain"]),code_commune:first(x,["code_commune"]),code_departement:first(x,["code_departement"]),adresse_numero:first(x,["adresse_numero"]),adresse_nom_voie:first(x,["adresse_nom_voie"]),code_postal:first(x,["code_postal"]),nombre_pieces_principales:first(x,["nombre_pieces_principales"])})),fallback:true};
        }
      })()
    ]);
    if(dpeResult.status!=="fulfilled")throw new Error("ADEME DPE indisponible : "+(dpeResult.reason?.message||"erreur source"));
    const dpeRaw=Array.isArray(dpeResult.value?.results)?dpeResult.value.results:Array.isArray(dpeResult.value?.data)?dpeResult.value.data:[];
    const dpeRows=dpeRaw.map(normalizeDpe);
    const dvfPack=dvfResult.status==="fulfilled"?dvfResult.value:{source:"DVF indisponible",rows:[],fallback:false};
    const report=analyzeDataQuality({dpeRows,dvfRows:dvfPack.rows||[]});
    return {...report,cityCode:codeInsee,dpeCount:dpeRows.length,dvfCount:(dvfPack.rows||[]).length,dvfSource:dvfPack.source,dvfFallback:Boolean(dvfPack.fallback)};
  }
  if(pathname==="/api/commune"){
    const q=url.searchParams.get("q")?.trim();
    if(!q) throw new Error("Paramètre q manquant");
    const known={
      "charleville mezieres":{city:"Charleville-Mézières",cityCode:"08105",postalCode:"08000"},
      "sedan":{city:"Sedan",cityCode:"08409",postalCode:"08200"},
      "rethel":{city:"Rethel",cityCode:"08362",postalCode:"08300"},
      "revin":{city:"Revin",cityCode:"08363",postalCode:"08500"},
      "givet":{city:"Givet",cityCode:"08190",postalCode:"08600"},
      "vouziers":{city:"Vouziers",cityCode:"08490",postalCode:"08400"}
    };
    const k=known[norm(q)];
    if(k) return [k];
    const c=await resolveCommune(q);
    if(c) return [c];
    return [];
  }
  if(pathname==="/api/dpe"){
    const q=url.searchParams.get("q")?.trim();
    const codeInsee=url.searchParams.get("codeInsee")?.trim();
    if(!q&&!codeInsee) throw new Error("Indique une commune, une adresse ou un code INSEE");
    const u=new URL(DPE_URL);u.searchParams.set("size",String(cleanLimit(url.searchParams.get("limit"),30)));
    if(codeInsee){u.searchParams.set("code_insee_ban_eq",codeInsee)}
    else u.searchParams.set("q",q);
    const data=await jsonFetch(u);
    const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[];
    return {source:"ADEME",total:Number(data?.total)||rows.length,results:rows.map(normalizeDpe),rawCount:rows.length};
  }
  if(pathname==="/api/radar"){
    let codeInsee=url.searchParams.get("codeInsee")?.trim();
    const q=url.searchParams.get("q")?.trim();
    if(!codeInsee&&q){const cc=await resolveCommune(q);codeInsee=cc?.cityCode||""}
    if(!codeInsee)throw new Error("Commune introuvable : indique une commune ou un code INSEE");
    const limit=cleanLimit(url.searchParams.get("limit"),100);
    const years=Number(url.searchParams.get("years"))||5;
    const yearMin=String(Math.max(2021,DVF_GEO_LATEST_YEAR-years+1));
    const yearMax=String(DVF_GEO_LATEST_YEAR);
    const dpeUrl=new URL(DPE_URL);
    dpeUrl.searchParams.set("code_insee_ban_eq",codeInsee);
    dpeUrl.searchParams.set("size",String(Math.min(100,limit)));
    const [dpeResult,dvfResult]=await Promise.allSettled([
      jsonFetch(dpeUrl),
      (async()=>{
        const u=new URL(DVF_URL);u.searchParams.set("code_insee",codeInsee);u.searchParams.set("page_size","1000");u.searchParams.set("anneemut_min",yearMin);u.searchParams.set("anneemut_max",yearMax);
        try{
          const data=await jsonFetch(u);const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
          return {source:"DVF+ Cerema",rows:rows.map(normalizeDvf)};
        }catch(e){
          const rows=await dvfGeoOpenData({codeInsee,yearMin,yearMax,limit:1000});
          return {source:"DVF open-data · data.gouv.fr",fallback:true,rows:rows.map(x=>({mutationId:first(x,["id_mutation"]),date:first(x,["date_mutation"]),year:(first(x,["date_mutation"])||"").slice(0,4),value:Number(first(x,["valeur_fonciere"]))||0,typeCode:first(x,["code_type_local"]),type:first(x,["type_local"]),builtArea:Number(first(x,["surface_reelle_bati"]))||0,landArea:Number(first(x,["surface_terrain"]))||0,cityCode:first(x,["code_commune"]),department:first(x,["code_departement"]),address:[first(x,["adresse_numero"]),first(x,["adresse_nom_voie"])].filter(Boolean).join(" "),postalCode:first(x,["code_postal"]),
            longitude:Number(first(x,["longitude","lon"]))||0,
            latitude:Number(first(x,["latitude","lat"]))||0,rooms:Number(first(x,["nombre_pieces_principales"]))||0,source:"DVF open-data · data.gouv.fr"}))};
        }
      })()
    ]);
    if(dpeResult.status!=="fulfilled")throw new Error("ADEME DPE indisponible pour cette commune : "+(dpeResult.reason?.message||"erreur source"));
    const dpeData=dpeResult.value;
    const dpeRows=(Array.isArray(dpeData?.results)?dpeData.results:Array.isArray(dpeData?.data)?dpeData.data:[]).map(normalizeDpe);
    const dvf=dvfResult.status==="fulfilled"?dvfResult.value:{source:"DVF indisponible",rows:[]};
    const dvfRows=dvf.rows||[];
    const indexes=buildDvfIndexes(dvfRows);
    const nowMs=Date.now();
    const candidates=dpeRows.map((p,index)=>{
      const match=findDvfMatches(p,indexes);
      const txs=match.txs||[];
      const latest=txs.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")))[0]||null;
      const nowMs=Date.now();
      const dpeDate=p.date?new Date(p.date):null;
      const dpeAge=dpeDate&&Number.isFinite(dpeDate.getTime())?Math.max(0,(nowMs-dpeDate.getTime())/86400000/365.25):null;
      const saleDate=latest?.date?new Date(latest.date):null;
      const saleAge=saleDate&&Number.isFinite(saleDate.getTime())?Math.max(0,(nowMs-saleDate.getTime())/86400000/365.25):null;
      const reasons=[]; let energy=0,holding=0,market=0,similarity=0,data=0,building=0;

      if(match.matchQuality==="exact")reasons.push("Rapprochement fort : numéro + rue + commune/CP");
      else if(match.matchQuality==="street")reasons.push("Rapprochement moyen : rue + commune/CP");
      else if(match.matchQuality==="postal")reasons.push("Rapprochement faible : code postal seul");
      else if(match.matchQuality==="proximity")reasons.push("Rapprochement géographique : ≤ 80 m");
      else reasons.push("Aucune mutation DVF rapprochée");

      if(["F","G"].includes(p.dpe)){energy+=18;reasons.push("DPE F/G +18")}
      else if(p.dpe==="E"){energy+=8;reasons.push("DPE E +8")}
      else if(p.dpe==="D"){energy+=3;reasons.push("DPE D +3")}
      if(dpeAge!==null){
        if(dpeAge>=7){energy+=7;reasons.push("DPE très ancien +7")}
        else if(dpeAge>=5){energy+=5;reasons.push("DPE ancien +5")}
        else if(dpeAge>=3){energy+=2;reasons.push("DPE de plus de 3 ans +2")}
      }
      if(p.energyConsumption>0){
        if(p.energyConsumption>=450){energy+=5;reasons.push("Consommation énergétique très élevée +5")}
        else if(p.energyConsumption>=330){energy+=4;reasons.push("Consommation énergétique élevée +4")}
        else if(p.energyConsumption>=250){energy+=2;reasons.push("Consommation énergétique élevée +2")}
      }
      if(p.gesValue>0){
        if(p.gesValue>=80){energy+=4;reasons.push("GES très élevé +4")}
        else if(p.gesValue>=50){energy+=3;reasons.push("GES élevé +3")}
        else if(p.gesValue>=30){energy+=1;reasons.push("GES notable +1")}
      }
      if(p.constructionYear>0){
        const age=Math.max(0,new Date().getFullYear()-p.constructionYear);
        if(age>=80){building+=5;reasons.push("Bâtiment très ancien +5")}
        else if(age>=50){building+=3;reasons.push("Bâtiment ancien +3")}
        else if(age>=30){building+=1;reasons.push("Bâtiment de plus de 30 ans +1")}
      }
      const btNorm=String(p.buildingType||"").toLowerCase();
      if(btNorm.includes("maison")){building+=2;reasons.push("Type maison +2")}
      else if(btNorm.includes("appartement")){building+=1;reasons.push("Type appartement +1")}

      if(match.matchQuality==="exact"&&saleAge!==null){
        if(saleAge>=10){holding+=25;reasons.push("Mutation exacte >10 ans +25")}
        else if(saleAge>=7){holding+=20;reasons.push("Mutation exacte 7–10 ans +20")}
        else if(saleAge>=5){holding+=14;reasons.push("Mutation exacte 5–7 ans +14")}
        else if(saleAge>=3){holding+=8;reasons.push("Mutation exacte 3–5 ans +8")}
        else if(saleAge>=2){holding+=4;reasons.push("Mutation exacte 2–3 ans +4")}
      }else if(match.matchQuality==="street"&&saleAge!==null){
        if(saleAge>=10){holding+=6;reasons.push("Ancienneté rue >10 ans +6")}
        else if(saleAge>=7){holding+=5;reasons.push("Ancienneté rue 7–10 ans +5")}
        else if(saleAge>=5){holding+=4;reasons.push("Ancienneté rue 5–7 ans +4")}
      }

      if(match.matchQuality==="exact"){
        if(txs.length>=3){market+=20;reasons.push("Adresse exacte : 3+ mutations +20")}
        else if(txs.length===2){market+=14;reasons.push("Adresse exacte : 2 mutations +14")}
        else if(txs.length===1){market+=8;reasons.push("Adresse exacte : 1 mutation +8")}
      }else if(match.matchQuality==="street"){
        if(txs.length>=3){market+=7;reasons.push("Même rue : 3+ mutations +7")}
        else if(txs.length>=1){market+=4;reasons.push("Même rue : mutation(s) +4")}
      }else if(match.matchQuality==="postal"){
        market+=1;reasons.push("Même code postal +1");
      }else if(match.matchQuality==="proximity"){
        market+=3;reasons.push("Transaction proche géographiquement +3");
      }

      const latestArea=Number(latest?.builtArea)||0;
      if(latestArea>0&&p.area>0){
        const ratio=Math.abs(p.area-latestArea)/Math.max(p.area,latestArea);
        if(ratio<=0.10){similarity+=10;reasons.push("Surface proche de la dernière mutation +10")}
        else if(ratio<=0.20){similarity+=6;reasons.push("Surface assez proche de la dernière mutation +6")}
        else if(ratio<=0.35){similarity+=3;reasons.push("Surface partiellement comparable +3")}
      }
      const bt=String(p.buildingType||"").toLowerCase(),lt=String(latest?.type||"").toLowerCase();
      const houseLike=/(maison|house)/.test(bt)&&/(maison|house)/.test(lt);
      const aptLike=/(appartement|appart|apartment)/.test(bt)&&/(appartement|appart|apartment)/.test(lt);
      if(latest&&(houseLike||aptLike)){similarity+=6;reasons.push("Type de bien cohérent avec la mutation +6")}
      if(latest?.rooms&&p.rooms&&Number(latest.rooms)===Number(p.rooms)){similarity+=4;reasons.push("Nombre de pièces identique +4")}
      else if(latest?.rooms&&p.rooms&&Math.abs(Number(latest.rooms)-Number(p.rooms))===1){similarity+=2;reasons.push("Nombre de pièces proche +2")}

      if(p.address)data+=3;
      if(p.cityCode===codeInsee)data+=2;
      if(p.postalCode)data+=2;
      if(p.area>0)data+=2;
      if(p.date)data+=1;
      if(data>=9)reasons.push("Données DPE complètes +9");
      else reasons.push("Complétude des données +"+data);

      const score=Math.min(100,energy+holding+market+similarity+data+building);
      const methodScores={
        energy:Math.min(100,Math.round(energy/25*100)),
        holding:Math.min(100,Math.round(holding/25*100)),
        market:Math.min(100,Math.round(market/20*100)),
        similarity:Math.min(100,Math.round(similarity/20*100)),
        data:Math.min(100,Math.round(data/10*100)),
        building:Math.min(100,Math.round(building/7*100))
      };
      const matchQuality=match.matchQuality;
      return {id:"dpe-"+(p.dpeNumber||index)+"-"+codeInsee,address:p.address,postalCode:p.postalCode,city:p.city,cityCode:p.cityCode,area:p.area,dpe:p.dpe,ges:p.ges,dpeDate:p.date,dpeAgeYears:dpeAge?Math.round(dpeAge*10)/10:null,buildingType:p.buildingType||"",energyConsumption:p.energyConsumption||0,gesValue:p.gesValue||0,constructionYear:p.constructionYear||0,latestSale:latest?{date:latest.date,value:latest.value,type:latest.type,builtArea:latest.builtArea,landArea:latest.landArea,rooms:latest.rooms}:null,matchQuality:match.matchQuality,matchReason:match.matchReason,distanceMeters:match.distanceMeters,postalCandidateCount:match.postalCount,source:"ADEME DPE + DVF",score,methodScores,reasons,disclaimer:"Indice de surveillance future basé sur des signaux publics immobiliers. Ce n'est pas une probabilité de vente ni l'identification d'un propriétaire."};
    }).filter(x=>x.address).sort((a,b)=>b.score-a.score).slice(0,limit);
    return {source:"ADEME DPE + DVF",codeInsee,dpeCount:dpeRows.length,dvfCount:dvfRows.length,dvfSource:dvf.source,dvfFallback:!!dvf.fallback,results:candidates};
  }
  if(pathname==="/api/backtest"){
    let codeInsee=url.searchParams.get("codeInsee")?.trim();
    const q=url.searchParams.get("q")?.trim();
    if(!codeInsee&&q){const c=await resolveCommune(q);codeInsee=c?.cityCode||""}
    if(!codeInsee)throw new Error("Commune introuvable : indique une commune ou un code INSEE");
    const years=Math.max(2,Math.min(5,Number(url.searchParams.get("years"))||5));
    const yearMin=String(Math.max(2021,DVF_GEO_LATEST_YEAR-years+1));
    const yearMax=String(DVF_GEO_LATEST_YEAR);
    const dpeUrl=new URL(DPE_URL);
    dpeUrl.searchParams.set("code_insee_ban_eq",codeInsee);
    dpeUrl.searchParams.set("size","10000");
    const [dpeResult,dvfResult]=await Promise.allSettled([
      jsonFetch(dpeUrl),
      (async()=>{
        const u=new URL(DVF_URL);
        u.searchParams.set("code_insee",codeInsee);
        u.searchParams.set("page_size","1000");
        u.searchParams.set("anneemut_min",yearMin);
        u.searchParams.set("anneemut_max",yearMax);
        try{
          const data=await jsonFetch(u);
          const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
          return {source:"DVF+ Cerema",rows:rows.map(normalizeDvf)};
        }catch(e){
          const rows=await dvfGeoOpenData({codeInsee,yearMin,yearMax,limit:10000});
          return {source:"DVF open-data · data.gouv.fr",fallback:true,rows:rows.map(x=>({
            mutationId:first(x,["id_mutation"]),date:first(x,["date_mutation"]),year:(first(x,["date_mutation"])||"").slice(0,4),
            value:Number(first(x,["valeur_fonciere"]))||0,typeCode:first(x,["code_type_local"]),type:first(x,["type_local"]),
            builtArea:Number(first(x,["surface_reelle_bati"]))||0,landArea:Number(first(x,["surface_terrain"]))||0,
            cityCode:first(x,["code_commune"]),department:first(x,["code_departement"]),
            address:[first(x,["adresse_numero"]),first(x,["adresse_nom_voie"])].filter(Boolean).join(" "),
            addressNumber:first(x,["adresse_numero"]),street:first(x,["adresse_nom_voie"]),
            postalCode:first(x,["code_postal"]),
            longitude:Number(first(x,["longitude","lon"]))||0,
            latitude:Number(first(x,["latitude","lat"]))||0,rooms:Number(first(x,["nombre_pieces_principales"]))||0,
            source:"DVF open-data · data.gouv.fr"
          }))};
        }
      })()
    ]);
    if(dpeResult.status!=="fulfilled")throw new Error("ADEME DPE indisponible pour le backtest : "+(dpeResult.reason?.message||"erreur source"));
    const dpeData=dpeResult.value;
    const dpeRows=(Array.isArray(dpeData?.results)?dpeData.results:Array.isArray(dpeData?.data)?dpeData.data:[]).map(normalizeDpe).filter(x=>x.address&&x.date);
    const dvf=dvfResult.status==="fulfilled"?dvfResult.value:{source:"DVF indisponible",rows:[]};
    const indexes=buildDvfIndexes(dvf.rows||[]);
    const allDvfDates=(dvf.rows||[]).map(x=>new Date(x.date)).filter(d=>Number.isFinite(d.getTime()));
    const latestDvfDate=allDvfDates.length?new Date(Math.max(...allDvfDates.map(d=>d.getTime()))):new Date(yearMax+"-12-31");
    const cutoff=new Date(latestDvfDate.getTime()-180*86400000);
    const H=180*86400000;
    const observations=[];
    let excludedRecent=0,exactMatched=0,streetOnly=0;
    for(const p of dpeRows){
      const d=new Date(p.date);
      if(!Number.isFinite(d.getTime()))continue;
      if(d>cutoff){excludedRecent++;continue}
      const parts=addressParts(p);
      const txs=(parts.exact?indexes.exact.get(parts.exact)||[]:[]).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
      const streetTxs=(parts.streetKey?indexes.street.get(parts.streetKey)||[]:[]);
      if(txs.length)exactMatched++; else if(streetTxs.length)streetOnly++;
      const prior=txs.filter(t=>{const td=new Date(t.date);return Number.isFinite(td.getTime())&&td<d;});
      const future=txs.filter(t=>{const td=new Date(t.date);return Number.isFinite(td.getTime())&&td>=d&&td.getTime()<=d.getTime()+H;});
      const sale=future[0]||null;
      const previous=prior[prior.length-1]||null;
      const previousAge=previous?.date?((d.getTime()-new Date(previous.date).getTime())/86400000/365.25):null;
      const sameAddressPrior=prior.length;
      let energy=0,holding=0,market=0,data=0;
      if(["F","G"].includes(p.dpe))energy+=20; else if(p.dpe==="E")energy+=8;
      if(previousAge!==null&&previousAge>=7)holding+=18;
      else if(!previous)holding+=8;
      if(sameAddressPrior>=3)market+=12; else if(sameAddressPrior>=1)market+=6;
      if(streetTxs.length>=2&&!txs.length)market+=3;
      if(p.area>=40&&p.area<=250)data+=4;
      if(p.address)data+=4;
      if(p.cityCode===codeInsee)data+=2;
      const radar=Math.min(100,energy+holding+market+data);
      const ensemble=Math.round([radar,Math.min(100,energy*3),Math.min(100,holding*4),Math.min(100,market*5),Math.min(100,data*10)].reduce((a,b)=>a+b,0)/5);
      observations.push({id:p.dpeNumber||p.address,date:p.date,address:p.address,dpe:p.dpe,area:p.area,saleWithin180:!!sale,saleDate:sale?.date||"",matchQuality:txs.length?"exact":streetTxs.length?"street":"none",scores:{futureRadar:radar,energy:Math.min(100,energy*3),holding:Math.min(100,holding*4),market:Math.min(100,market*5),data:Math.min(100,data*10),ensemble}});
    }
    const methods=[["futureRadar","Radar futur"],["energy","Énergie / DPE"],["holding","Ancienneté"],["market","Historique marché"],["data","Complétude des données"],["ensemble","Ensemble"]];
    const baseline=observations.length?observations.filter(x=>x.saleWithin180).length/observations.length*100:0;
    const metrics=methods.map(([key,label])=>{
      const sorted=observations.slice().sort((a,b)=>b.scores[key]-a.scores[key]);
      const k=Math.max(1,Math.ceil(sorted.length*.2));
      const top=sorted.slice(0,k);
      const success=top.filter(x=>x.saleWithin180).length;
      const precision=success/k*100;
      return {key,label,n:observations.length,k,success,precision,lift:baseline?precision/baseline:null};
    });
    return {source:"ADEME DPE + DVF historique",codeInsee,years,yearMin,yearMax,dpeCount:dpeRows.length,dvfCount:(dvf.rows||[]).length,matched:observations.length,baseline,exactMatched,streetOnly,excludedRecent,latestDvfDate:latestDvfDate.toISOString().slice(0,10),cutoffDate:cutoff.toISOString().slice(0,10),metrics,observations,disclaimer:"Backtest rétrospectif corrigé : seules les observations ayant un horizon complet de 180 jours avant la dernière mutation DVF disponible sont évaluées. Une mutation positive doit correspondre à la même adresse (numéro + rue + commune/CP). Une correspondance de rue seule est informative mais ne compte pas comme vente à cette adresse. Cela mesure une association historique, pas une probabilité future ni une identification de propriétaire."};
  }
  if(pathname==="/api/dvf"){
    let codeInsee=url.searchParams.get("codeInsee")?.trim();
    const q=url.searchParams.get("q")?.trim();
    if(!codeInsee&&q){const c=await resolveCommune(q);codeInsee=c?.cityCode||""}
    if(!codeInsee)throw new Error("Commune introuvable : indique un nom de commune ou un code INSEE");
    const limit=cleanLimit(url.searchParams.get("limit"),50);
    const yearMin=url.searchParams.get("yearMin")||String(DVF_GEO_LATEST_YEAR-4);
    const yearMax=url.searchParams.get("yearMax")||String(DVF_GEO_LATEST_YEAR);
    const type=url.searchParams.get("type");
    try{
      const u=new URL(DVF_URL);
      u.searchParams.set("code_insee",codeInsee);
      u.searchParams.set("page_size",String(limit));
      u.searchParams.set("anneemut_min",yearMin);
      u.searchParams.set("anneemut_max",yearMax);
      if(type)u.searchParams.set("codtypbien",type);
      const data=await jsonFetch(u);
      const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
      return {source:"DVF+ Cerema",codeInsee,total:Number(data?.count??data?.total)||rows.length,results:rows.map(normalizeDvf),rawCount:rows.length};
    }catch(ceremaError){
      const rows=await dvfGeoOpenData({codeInsee,yearMin,yearMax,limit});
      const normalized=rows.map(x=>({
        mutationId:first(x,["id_mutation"]),
        date:first(x,["date_mutation"]),
        year:(first(x,["date_mutation"])||"").slice(0,4),
        value:Number(first(x,["valeur_fonciere"]))||0,
        typeCode:first(x,["code_type_local"]),
        type:first(x,["type_local"]),
        builtArea:Number(first(x,["surface_reelle_bati"]))||0,
        landArea:Number(first(x,["surface_terrain"]))||0,
        cityCode:first(x,["code_commune"]),
        department:first(x,["code_departement"]),
        address:[first(x,["adresse_numero"]),first(x,["adresse_nom_voie"])].filter(Boolean).join(" "),
        postalCode:first(x,["code_postal"]),
            longitude:Number(first(x,["longitude","lon"]))||0,
            latitude:Number(first(x,["latitude","lat"]))||0,
        rooms:Number(first(x,["nombre_pieces_principales"]))||0,
        source:"DVF open-data · data.gouv.fr"
      }));
      return {source:"DVF Ardennes / open-data",codeInsee,total:normalized.length,results:normalized,rawCount:normalized.length,fallback:true,primaryError:ceremaError.message};
    }
  }
  throw new Error("Route API inconnue");
}

async function handle(req,res){
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET" && url.pathname.startsWith("/api/")){
    try{return send(res,200,await api(url.pathname,url))}
    catch(e){return send(res,502,{ok:false,error:e.message||"Erreur source publique"})}
  }
  if(req.method!=="GET") return send(res,405,{error:"Méthode non autorisée"});
  let file=url.pathname==="/"?"/index.html":url.pathname;
  file=path.normalize(file).replace(/^(.\.[\\/])+/, "");
  const full=path.join(ROOT,file);
  if(!full.startsWith(ROOT)) return send(res,403,{error:"Accès refusé"});
  fs.readFile(full,(err,data)=>{
    if(err)return send(res,404,{error:"Fichier introuvable"});
    const ext=path.extname(full).toLowerCase();
    res.writeHead(200,{"Content-Type":MIME[ext]||"application/octet-stream","Cache-Control":(ext===".html"||ext===".js"||ext===".css")?"no-cache":"public,max-age=3600"});
    res.end(data);
  });
}
http.createServer(handle).listen(PORT,()=>console.log("JML Prospection server listening on port "+PORT));
