const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines";
const DVF_URL = "https://apidf.cerema.fr/dvf_opendata/mutations/";
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
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"JML-Prospection/1.0"},signal:controller.signal});
    const text=await r.text();
    let data;
    try{data=JSON.parse(text)}catch{data={raw:text}}
    if(!r.ok) throw new Error("Source HTTP "+r.status);
    return data;
  }finally{clearTimeout(timer)}
}
function first(obj,keys){for(const k of keys){if(obj?.[k]!==undefined&&obj?.[k]!==null&&obj[k]!=="")return obj[k]}return ""}
function normalizeDpe(x){
  return {
    dpeNumber:first(x,["N°DPE","Numero_DPE","N°DPE_(CSTB)","numero_dpe"]),
    address:first(x,["Adresse_brute","Adresse_(BAN)","Adresse_BAN","adresse_ban"]),
    postalCode:first(x,["Code_postal_(BAN)","Code_postal","code_postal_ban"]),
    city:first(x,["Nom_commune_(BAN)","Nom_commune","nom_commune_ban"]),
    cityCode:first(x,["Code_INSEE_(BAN)","Code_INSEE","code_insee_ban"]),
    area:Number(first(x,["Surface_habitable_logement","Surface_habitable","surface_habitable_logement"]))||0,
    dpe:first(x,["Etiquette_DPE","Etiquette_DPE_(à_date)","Etiquette_DPE_logement"]),
    ges:first(x,["Etiquette_GES","Etiquette_GES_logement"]),
    date:first(x,["Date_établissement_DPE","Date_établissement","date_etablissement_dpe"]),
    source:"DPE ADEME"
  };
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
    cityCode:first(x,["codcomm","code_commune"]),
    department:first(x,["coddep","code_departement"]),
    source:"DVF+ Cerema"
  };
}
async function resolveCommune(query){
  if(!query) return null;
  const u=new URL(ADDRESS_URL);
  u.searchParams.set("q",query);
  u.searchParams.set("type","municipality");
  u.searchParams.set("limit","1");
  const data=await jsonFetch(u);
  const f=data?.features?.[0];
  if(!f) return null;
  return {city:f.properties?.city||f.properties?.label||"",cityCode:f.properties?.citycode||"",postalCode:f.properties?.postcode||"",label:f.properties?.label||""};
}
async function api(pathname,url){
  if(pathname==="/api/health") return {ok:true,sources:{dpe:"ADEME",dvf:"DVF+ Cerema",geocoding:"API Adresse"},server:"jml-prospection",version:"1.6.0"};
  if(pathname==="/api/commune"){
    const q=url.searchParams.get("q")?.trim();
    if(!q) throw new Error("Paramètre q manquant");
    const u=new URL(ADDRESS_URL);u.searchParams.set("q",q);u.searchParams.set("type","municipality");u.searchParams.set("limit","5");
    const data=await jsonFetch(u);
    return (data.features||[]).map(f=>({city:f.properties?.city||"",cityCode:f.properties?.citycode||"",postalCode:f.properties?.postcode||"",label:f.properties?.label||""}));
  }
  if(pathname==="/api/dpe"){
    const q=url.searchParams.get("q")?.trim();
    const codeInsee=url.searchParams.get("codeInsee")?.trim();
    if(!q&&!codeInsee) throw new Error("Indique une commune, une adresse ou un code INSEE");
    const u=new URL(DPE_URL);u.searchParams.set("size",String(cleanLimit(url.searchParams.get("limit"),30)));
    if(codeInsee){u.searchParams.set("q_fields","Code_INSEE_(BAN)");u.searchParams.set("q",codeInsee)}
    else u.searchParams.set("q",q);
    const data=await jsonFetch(u);
    const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[];
    return {source:"ADEME",total:Number(data?.total)||rows.length,results:rows.map(normalizeDpe),rawCount:rows.length};
  }
  if(pathname==="/api/dvf"){
    let codeInsee=url.searchParams.get("codeInsee")?.trim();
    const q=url.searchParams.get("q")?.trim();
    if(!codeInsee&&q){const c=await resolveCommune(q);codeInsee=c?.cityCode||""}
    if(!codeInsee) throw new Error("Commune introuvable : indique un nom de commune ou un code INSEE");
    const u=new URL(DVF_URL);
    u.searchParams.set("code_commune",codeInsee);
    u.searchParams.set("page_size",String(cleanLimit(url.searchParams.get("limit"),50)));
    const yearMin=url.searchParams.get("yearMin");if(yearMin)u.searchParams.set("anneemut_min",yearMin);
    const yearMax=url.searchParams.get("yearMax");if(yearMax)u.searchParams.set("anneemut_max",yearMax);
    const type=url.searchParams.get("type");if(type)u.searchParams.set("codtypbien",type);
    const data=await jsonFetch(u);
    const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
    return {source:"DVF+ Cerema",codeInsee,total:Number(data?.count??data?.total)||rows.length,results:rows.map(normalizeDvf),rawCount:rows.length};
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
    res.writeHead(200,{"Content-Type":MIME[ext]||"application/octet-stream","Cache-Control":ext===".html"?"no-cache":"public,max-age=3600"});
    res.end(data);
  });
}
http.createServer(handle).listen(PORT,()=>console.log("JML Prospection server listening on port "+PORT));
