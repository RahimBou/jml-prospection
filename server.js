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
    postalCode:first(x,["code_postal_ban","Code_postal_(BAN)","Code_postal"]),
    city:first(x,["nom_commune_ban","Nom_commune_(BAN)","Nom_commune"]),
    cityCode:first(x,["code_insee_ban","Code_INSEE_(BAN)","Code_INSEE"]),
    area:Number(first(x,["Surface_habitable_logement","surface_habitable_logement","surface_habitable_immeuble","Surface_habitable_immeuble","Surface_habitable"]))||0,
    dpe:first(x,["etiquette_dpe","Etiquette_DPE","Etiquette_DPE_(à_date)","Etiquette_DPE_logement"]),
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
    landArea:Number(first(x,["sterr","surface_terrain"]))||0,
    cityCode:first(x,["codcomm","code_commune","l_codinsee"]),
    department:first(x,["coddep","code_departement"]),
    source:"DVF+ Cerema"
  };
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
  if(pathname==="/api/health") return {ok:true,sources:{dpe:"ADEME",dvf:"DVF+ Cerema",geocoding:"API Adresse"},server:"jml-prospection",version:"1.8.0"};
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
