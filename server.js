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
const communeGeoCache = new Map();
const DVF_LOCAL_FILE = path.join(ROOT,"data","dvf_ardennes.csv.gz");
let dvfLocalCache = null;
const ADDRESS_URL = "https://data.geopf.fr/geocodage/search/";
const { analyze: analyzeDataQuality } = require("./data-agent");
const { runAi } = require("./ai-agent");
const { searchFreeWebListings } = require("./free-web-sources");

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
async function fetchDvfPaginated(baseUrl,{codeInsee,yearMin,yearMax,maxRows=10000}){
  const rows=[];
  const seenPages=new Set();
  let page=1;
  while(rows.length<maxRows){
    const u=new URL(baseUrl);
    u.searchParams.set("code_insee",codeInsee);
    u.searchParams.set("anneemut_min",String(yearMin));
    u.searchParams.set("anneemut_max",String(yearMax));
    u.searchParams.set("page_size","500");
    u.searchParams.set("page",String(page));
    const data=await jsonFetch(u);
    const batch=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
    if(!batch.length)break;
    rows.push(...batch);
    const next=String(data?.next||"");
    if(!next)break;
    if(seenPages.has(next))break;
    seenPages.add(next);
    page++;
    if(page>100)break;
  }
  return rows.slice(0,maxRows);
}

async function fetchBdnbAddress(address,city=""){
  const q=String(address||"").trim();
  if(!q)return [];
  const base="https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/adresse";
  const queries=[
    q,
    [q,city].filter(Boolean).join(" ")
  ];
  for(const label of queries){
    try{
      const u=new URL(base);
      u.searchParams.set("select","batiment_groupe_id,libelle_adr_principale_ban,cle_interop_adr,nb_log,identifiant_dpe");
      u.searchParams.set("libelle_adr_principale_ban","eq."+label);
      u.searchParams.set("limit","5");
      const data=await jsonFetch(u);
      const rows=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:[];
      if(rows.length)return rows;
    }catch{}
  }
  return [];
}
async function fetchDpeCandidates(address,city=""){
  const terms=[String(address||"").trim(),[String(address||"").trim(),String(city||"").trim()].filter(Boolean).join(" ")].filter(Boolean);
  const seen=new Set(),out=[];
  for(const term of terms){
    try{
      const u=new URL(DPE_URL);
      u.searchParams.set("size","20");
      u.searchParams.set("q",term);
      const data=await jsonFetch(u);
      const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[];
      for(const row of rows){
        const d=normalizeDpe(row);
        const key=d.dpeNumber||[d.address,d.postalCode,d.area,d.dpe].join("|");
        if(!seen.has(key)){seen.add(key);out.push(d)}
      }
    }catch{}
  }
  return out;
}


async function fetchStreamEstate(params={}){
  const apiKey=String(process.env.STREAM_ESTATE_API_KEY||"").trim();
  if(!apiKey)throw new Error("STREAM_ESTATE_API_KEY non configurée sur Render");
  const city=String(params.ville||"").trim();
  let cityCode=String(params.cityCode||"").trim();
  if(!cityCode&&city){
    try{const geo=await geocodeAddress(city,5);cityCode=String(geo?.[0]?.cityCode||"").trim()}catch{}
  }
  const property={transaction:{type:"SELL"}};
  const type=String(params.type||"").trim();
  const typeMap={Appartement:"FLAT",Maison:"HOUSE",Terrain:"LAND",Immeuble:"BUILDING",Garage:"GARAGE","Local commercial":"COMMERCIAL"};
  if(typeMap[type])property.type={in:[typeMap[type]]};
  const min=Number(params.prix_min)||0,max=Number(params.prix_max)||0;
  if(min>0||max>0)property.pricing={displayed:{...(min>0?{gte:min}:{}),...(max>0?{lte:max}:{})}};
  const surface=Number(params.surface_min)||0;
  if(surface>0)property.area={displayed:{gte:surface}};
  if(cityCode)property.locations={countryCode:"FR",in:{uniqueCodes:[cityCode]}};
  const body={criteria:{property},paginationType:"PAGE",page:1,size:Math.min(100,Math.max(1,Number(params.page_size)||50))};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch("https://api-v2.stream.estate/properties",{
      method:"POST",
      headers:{"Accept":"application/json","Content-Type":"application/json","X-API-KEY":apiKey,"User-Agent":"JML-Prospection/1.38.0"},
      body:JSON.stringify(body),signal:controller.signal
    });
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!r.ok)throw new Error("Stream Estate HTTP "+r.status);
    const rows=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:Array.isArray(data?.properties)?data.properties:[];
    const items=rows.map((x)=>{
      const p=x?.property||x?.attributes||x||{}, listings=Array.isArray(x?.listings)?x.listings:[],l=listings[0]||{};
      const loc=p.location||{},cityObj=loc.city||{};
      const coords=loc.geometry?.coordinates||[];
      const area=p.area?.displayed??p.area?.living??p.area??l.area;
      const rooms=p.unit?.rooms??p.rooms??l.rooms;
      const price=p.pricing?.displayed??p.pricing?.sale?.netPrice??l.displayedPrice;
      return {
        reference:x.id||l.id||"",
        title:l.title||p.body?.title||"",
        description:l.description||p.body?.description||"",
        price:Number(price)||0,surface:Number(area)||0,rooms:Number(rooms)||0,
        type:type||String(l.propertyType||p.propertyType||""),
        city:cityObj.name||city,postal_code:Array.isArray(cityObj.postalCodes)?cityObj.postalCodes[0]||"":String(cityObj.postalCodes||""),
        latitude:Number(coords[1]??loc.latitude),longitude:Number(coords[0]??loc.longitude),
        external_url:l.url||"",source:(l.source?.slug||"Stream Estate"),
        seller_type:(x?.publishers?.[0]?.publisherType||""),
        dpe:p.unit?.diagnostic?.scores?.property1?.rating||"",
        published_at:l.publishedAt||l.createdAt||"",updated_at:l.updatedAt||p.updatedAt||"",
        sources:listings.map(z=>({source:z.source?.slug||"",reference:z.id||"",url:z.url||"",price:Number(z.displayedPrice)||0}))
      };
    });
    return {source:"Stream Estate",total:Number(data?.meta?.totalItems)||items.length,pageSize:items.length,hasMore:Boolean(data?.meta?.hasNextPage),nextCursor:data?.meta?.cursor||null,items};
  }finally{clearTimeout(timer)}
}
async function pingStreamEstate(){
  const apiKey=String(process.env.STREAM_ESTATE_API_KEY||"").trim();
  if(!apiKey)return {source:"Stream Estate",configured:false,ok:false,error:"Clé API absente"};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch("https://api-v2.stream.estate/sources?page=1",{headers:{"Accept":"application/json","X-API-KEY":apiKey,"User-Agent":"JML-Prospection/1.38.0"},signal:controller.signal});
    if(!r.ok)return {source:"Stream Estate",configured:true,ok:false,error:"HTTP "+r.status};
    return {source:"Stream Estate",configured:true,ok:true};
  }catch(e){return {source:"Stream Estate",configured:true,ok:false,error:e.message||"inaccessible"}}
  finally{clearTimeout(timer)}
}

async function fetchChercherTrouver(params={}){
  const apiKey=String(process.env.CHERCHERTROUVER_API_KEY||"").trim();
  if(!apiKey) throw new Error("CHERCHERTROUVER_API_KEY non configurée sur le serveur Render");
  const u=new URL("https://cherchertrouver.immo/api/v1/annonces");
  for(const [k,v] of Object.entries(params)){
    if(v!==undefined&&v!==null&&String(v)!=="")u.searchParams.set(k,String(v));
  }
  u.searchParams.set("page_size",String(Math.min(100,Math.max(1,Number(params.page_size)||50))));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(u,{headers:{
      "Accept":"application/json",
      "X-Api-Key":apiKey,
      "User-Agent":"JML-Prospection/1.14.0"
    },signal:controller.signal});
    const text=await r.text();
    let data; try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!r.ok){
      const detail=data?.error||("ChercherTrouver HTTP "+r.status);
      throw new Error(detail);
    }
    return {
      source:"ChercherTrouver.immo",
      total:Number(data?.total)||Number(data?.count)||0,
      page:Number(data?.page)||1,
      pageSize:Number(data?.page_size)||0,
      hasMore:Boolean(data?.has_more),
      nextCursor:data?.next_cursor||null,
      items:Array.isArray(data?.items)?data.items:[]
    };
  }finally{clearTimeout(timer)}
}

async function fetchChercherTrouverPing(){
  const apiKey=String(process.env.CHERCHERTROUVER_API_KEY||"").trim();
  if(!apiKey) throw new Error("CHERCHERTROUVER_API_KEY non configurée sur le serveur Render");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch("https://cherchertrouver.immo/api/v1/ping",{
      headers:{Accept:"application/json","X-Api-Key":apiKey,"User-Agent":"JML-Prospection/1.15.0"},
      signal:controller.signal
    });
    const text=await r.text();
    let data; try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!r.ok){
      const detail=data?.error||("ChercherTrouver HTTP "+r.status);
      throw new Error(detail);
    }
    return {source:"ChercherTrouver.immo",ok:true,tier:data?.tier||null,rateLimitPerMin:Number(data?.rate_limit_per_min)||null,itemsPerDay:Number(data?.items_per_day)||null,serverTime:data?.server_time||null};
  }finally{clearTimeout(timer)}
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
    buildingRef:first(x,["compl_ref_batiment","Compl_ref_batiment","compl_ref_batiment_dpe"]),
    apartmentRef:first(x,["compl_ref_logement","Compl_ref_logement","compl_ref_logement_dpe"]),
    floor:first(x,["compl_etage_appartement","Compl_etage_appartement","position_logement_dans_immeuble"]),
    residenceName:first(x,["nom_residence","Nom_residence"]),
    banId:first(x,["identifiant_ban","Identifiant_BAN","id_ban"]),
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
    natureMutation:first(x,["libnatmut","nature_mutation","naturemutation"]),
    value:Number(first(x,["valeurfonc","valeur_fonciere"]))||0,
    typeCode:first(x,["codtypbien","code_type_bien"]),
    type:first(x,["libtypbien","lib_type_bien"]),
    builtArea:Number(first(x,["sbati","surface_batie"]))||0,
    builtAreaKind:"built",
    landArea:Number(first(x,["sterr","surface_terrain"]))||0,
    landAreaKind:"land",
    carrezArea:Number(first(x,["lot_1_surface_carrez","lot_1_surface_carrez_m2","surface_carrez"]))||0,
    lotCount:Number(first(x,["nombre_lots","nblot"]))||0,
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
function unitTypeCompatible(property,tx){
  const p=String(property?.buildingType||"").toLowerCase();
  const t=String(tx?.type||"").toLowerCase();
  if(!p||!t)return null;
  const house=/(maison|house)/.test(p)&&/(maison|house)/.test(t);
  const apartment=/(appartement|appart|apartment)/.test(p)&&/(appartement|appart|apartment)/.test(t);
  return house||apartment;
}
function unitMatchScore(property,tx){
  let score=0,evidence=0;
  const pa=Number(property?.area)||0;
  const ta=Number(tx?.builtArea)||0;
  const ca=Number(tx?.carrezArea)||0;
  const referenceArea=ca>0?ca:ta;
  let surfaceRatio=null;
  if(pa>0&&referenceArea>0){
    surfaceRatio=Math.abs(pa-referenceArea)/Math.max(pa,referenceArea);
    evidence++;
    if(surfaceRatio<=0.08)score+=7;
    else if(surfaceRatio<=0.15)score+=5;
    else if(surfaceRatio<=0.25)score+=2;
    else score-=5;
  }
  const type=unitTypeCompatible(property,tx);
  if(type!==null){evidence++;score+=type?3:-2}
  const pr=Number(property?.rooms)||0;
  const tr=Number(tx?.rooms)||0;
  if(pr>0&&tr>0){
    evidence++;
    if(pr===tr)score+=3;
    else if(Math.abs(pr-tr)===1)score+=1;
    else score-=2;
  }
  const distance=distanceMeters(pointOf(property),pointOf(tx));
  if(distance!==null&&distance<=30){evidence++;score+=2}
  return {score,evidence,distance,surfaceRatio};
}
function selectUnitTransactions(property,txs){
  const list=Array.from(txs||[]);
  if(!list.length)return {txs:[],unitConfidence:"none",unitReason:"Aucune mutation à l'adresse",matchedCount:0,selectedCount:0};
  const scored=list.map(tx=>({tx,...unitMatchScore(property,tx)}));
  const informative=scored.filter(x=>x.evidence>0);
  if(!informative.length){
    return {txs:list,unitConfidence:"unknown",unitReason:"Adresse exacte mais aucune caractéristique d'unité exploitable",matchedCount:list.length,selectedCount:list.length};
  }
  const best=Math.max(...informative.map(x=>x.score));
  const top=informative.filter(x=>x.score===best);
  if(best<3){
    return {txs:[],unitConfidence:"ambiguous",unitReason:"Adresse commune mais caractéristiques insuffisantes pour isoler le logement",matchedCount:list.length,selectedCount:0};
  }

  // Regroupe l'historique autour du meilleur logement : même type/pièces
  // et surface suffisamment proche. Une autre surface dans le même immeuble
  // ne doit pas hériter automatiquement de toutes les mutations.
  const bestRef=top[0];
  const selected=informative.filter(x=>{
    if(x.score<best-1)return false;
    const typeOk=unitTypeCompatible(property,x.tx)!==false;
    const roomsOk=(!Number(property?.rooms)||!Number(x.tx?.rooms))||Math.abs(Number(property.rooms)-Number(x.tx.rooms))<=1;
    const ratio=x.surfaceRatio;
    const bestRatio=bestRef.surfaceRatio;
    const surfaceOk=ratio===null||bestRatio===null||Math.abs(ratio-bestRatio)<=0.04;
    return typeOk&&roomsOk&&surfaceOk;
  }).map(x=>x.tx);

  if(selected.length===0){
    return {txs:[],unitConfidence:"ambiguous",unitReason:"Plusieurs logements à la même adresse, aucun rapprochement assez discriminant",matchedCount:list.length,selectedCount:0};
  }
  const ambiguousTop=top.length>1;
  if(ambiguousTop){
    return {
      txs:selected,
      unitConfidence:"ambiguous",
      unitReason:"Même adresse · plusieurs logements compatibles",
      matchedCount:list.length,
      selectedCount:selected.length
    };
  }
  return {
    txs:selected,
    unitConfidence:"probable",
    unitReason:selected.length===1?"Logement rapproché par surface/type/pièces":"Logement rapproché · historique de mutations conservé",
    matchedCount:list.length,
    selectedCount:selected.length
  };
}
function comparableType(property,tx){
  const p=String(property?.buildingType||"").toLowerCase();
  const t=String(tx?.type||"").toLowerCase();
  if(/appartement|appart|apartment/.test(p))return /appartement|appart|apartment/.test(t);
  if(/maison|house/.test(p))return /maison|house/.test(t);
  return null;
}
function comparableArea(tx,property){
  const p=String(property?.buildingType||"").toLowerCase();
  if(/appartement|appart|apartment/.test(p) && Number(tx?.carrezArea)>0)return Number(tx.carrezArea);
  return Number(tx?.builtArea)>0?Number(tx.builtArea):Number(tx?.carrezArea)||0;
}
function median(values){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function percentile(values,p){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);
}
function localComparables(property,rows){
  const targetPoint=pointOf(property),targetArea=Number(property?.area)||0,targetRooms=Number(property?.rooms)||0;
  const now=Date.now(),seen=new Set(),pool=[];
  const propertyType=String(property?.buildingType||"").toLowerCase();
  const isApartment=/appartement|appart|apartment/.test(propertyType);
  for(const tx of rows||[]){
    const id=tx.mutationId||[tx.date,tx.value,tx.address,tx.builtArea].join("|");
    if(seen.has(id))continue;
    seen.add(id);
    if(!tx?.value||tx.value<10000)continue;
    if(comparableType(property,tx)!==true)continue;
    const area=comparableArea(tx,property);
    if(targetArea<=0||area<=0)continue;
    const surfaceRatio=Math.abs(targetArea-area)/Math.max(targetArea,area);
    if(surfaceRatio>0.20)continue;
    // Ne pas exclure un appartement parce que la mutation contient plusieurs lots :\n    // cave, parking ou dépendance peuvent faire monter lotCount sans invalider le logement.
    const rooms=Number(tx?.rooms)||0;
    const roomDiff=targetRooms&&rooms?Math.abs(targetRooms-rooms):null;
    if(roomDiff!==null&&roomDiff>1)continue;
    const point=pointOf(tx);
    const distance=targetPoint&&point?distanceMeters(targetPoint,point):null;
    if(distance!==null&&distance>500)continue;
    const date=tx.date?new Date(tx.date):null;
    const ageYears=date&&Number.isFinite(date.getTime())?Math.max(0,(now-date.getTime())/86400000/365.25):null;
    if(ageYears!==null&&ageYears>5.5)continue;
    const priceM2=tx.value/area;
    if(!Number.isFinite(priceM2)||priceM2<100||priceM2>15000)continue;
    const distanceScore=distance===null?3:Math.max(0,30*(1-distance/500));
    const surfaceScore=Math.max(0,35*(1-surfaceRatio/0.20));
    const roomScore=roomDiff===null?5:(roomDiff===0?15:7);
    const recencyScore=ageYears===null?2:Math.max(0,7*(1-ageYears/5.5));
    pool.push({tx,distance,area,rooms,priceM2,ageYears,surfaceRatio,qualityScore:distanceScore+surfaceScore+roomScore+recencyScore});
  }
  let radius=100;
  let selected=pool.filter(x=>x.distance===null||x.distance<=100);
  if(selected.length<5){radius=250;selected=pool.filter(x=>x.distance===null||x.distance<=250)}
  if(selected.length<5){radius=500;selected=pool.filter(x=>x.distance===null||x.distance<=500)}
  selected.sort((a,b)=>b.qualityScore-a.qualityScore);
  selected=selected.slice(0,10);
  const prices=selected.map(x=>x.priceM2);
  const med=median(prices),q1=percentile(prices,.25),q3=percentile(prices,.75);
  const recent=selected.filter(x=>x.ageYears!==null&&x.ageYears<=2).length;
  const knownDistances=selected.map(x=>x.distance).filter(Number.isFinite);
  const unknownDistanceCount=selected.length-knownDistances.length;
  const medianDistance=median(knownDistances);
  const distanceCoverage=selected.length?knownDistances.length/selected.length:0;
  const distanceStatus=selected.length===0
    ?"Aucun comparable"
    :unknownDistanceCount===0
      ?"Distances calculées · rayon "+radius+" m"
      :knownDistances.length>0
        ?"Distance partiellement disponible · "+knownDistances.length+"/"+selected.length+" distances"
        :"Distance indisponible pour les comparables";
  const dispersion=med&&q1!==null&&q3!==null?(q3-q1)/med:null;
  let marketScore=0;
  if(selected.length>=8)marketScore+=5;else if(selected.length>=5)marketScore+=4;else if(selected.length>=3)marketScore+=3;else if(selected.length>=2)marketScore+=2;else if(selected.length===1)marketScore+=1;
  if(recent>=4)marketScore+=2;else if(recent>=2)marketScore+=1;
  if(dispersion!==null){if(dispersion<=0.15)marketScore+=3;else if(dispersion<=0.25)marketScore+=2;else if(dispersion<=0.40)marketScore+=1}
  marketScore=Math.min(10,marketScore);
  const best=selected[0]||null;
  return {
    count:selected.length,radius:unknownDistanceCount===0?radius:null,selectionRadius:radius,medianPriceM2:med,q1,q3,dispersion,medianDistance,recentCount:recent,marketScore,distanceKnownCount:knownDistances.length,distanceUnknownCount:unknownDistanceCount,distanceCoverage,distanceStatus,
    best:best?{date:best.tx.date,value:best.tx.value,type:best.tx.type,builtArea:best.tx.builtArea,carrezArea:best.tx.carrezArea,rooms:best.tx.rooms,landArea:best.tx.landArea,priceM2:best.priceM2,distanceMeters:best.distance,surfaceRatio:best.surfaceRatio}:null,
    items:selected.map(x=>({date:x.tx.date,value:x.tx.value,type:x.tx.type,area:x.area,rooms:x.rooms,priceM2:x.priceM2,distanceMeters:x.distance}))
  };
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
  if(candidates.length){
    const unit=selectUnitTransactions(property,candidates);
    return {txs:unit.txs,matchQuality:"exact",matchReason:"Adresse normalisée + commune/CP",distanceMeters:null,postalCount,unitConfidence:unit.unitConfidence,unitReason:unit.unitReason};
  }
  candidates=unique(indexes.numberStreet.get(p.numberStreet)||[]).filter(sameCommune);
  if(candidates.length){
    const unit=selectUnitTransactions(property,candidates);
    return {txs:unit.txs,matchQuality:"exact",matchReason:"Numéro + rue + commune/CP",distanceMeters:null,postalCount,unitConfidence:unit.unitConfidence,unitReason:unit.unitReason};
  }
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
async function getDepartmentCommunes(department="08"){
  const dept=String(department||"08").trim();
  if(communeGeoCache.has(dept))return communeGeoCache.get(dept);
  const u=new URL("https://geo.api.gouv.fr/communes");
  u.searchParams.set("codeDepartement",dept);
  u.searchParams.set("fields","nom,code,codesPostaux,codeDepartement,centre,population");
  u.searchParams.set("format","json");
  u.searchParams.set("geometry","centre");
  const data=await jsonFetch(u);
  const rows=(Array.isArray(data)?data:[]).map(x=>{
    const c=x?.centre?.coordinates||[];
    return {city:x?.nom||"",cityCode:x?.code||"",postalCode:Array.isArray(x?.codesPostaux)?x.codesPostaux[0]||"": "",department:x?.codeDepartement||dept,population:Number(x?.population)||0,point:(Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))?{kind:"lonlat",x:Number(c[0]),y:Number(c[1])}:null};
  }).filter(x=>x.cityCode);
  communeGeoCache.set(dept,rows);
  if(communeGeoCache.size>10)communeGeoCache.delete(communeGeoCache.keys().next().value);
  return rows;
}

async function geocodeAddress(query,limit=5){
  const q=String(query||"").trim();
  if(!q)return [];
  const u=new URL(ADDRESS_URL);
  u.searchParams.set("q",q);
  u.searchParams.set("limit",String(Math.min(10,Math.max(1,Number(limit)||5))));
  const data=await jsonFetch(u);
  const features=Array.isArray(data?.features)?data.features:[];
  return features.map(f=>{
    const p=f?.properties||{},c=f?.geometry?.coordinates||[];
    return {
      label:p.label||"",
      address:p.label||"",
      housenumber:p.housenumber||"",
      street:p.street||"",
      postalCode:p.postcode||"",
      city:p.city||"",
      cityCode:p.citycode||"",
      context:p.context||"",
      score:Number(p.score)||0,
      longitude:Number(c[0])||0,
      latitude:Number(c[1])||0,
      banId:p.id||""
    };
  });
}

function classifyDataQuality(p){
  const checks=[Boolean(String(p?.address||"").trim()),Boolean(String(p?.postalCode||"").trim()||String(p?.cityCode||"").trim()),Number(p?.area)>0,Boolean(String(p?.date||"").trim()),Boolean(String(p?.dpe||"").trim())];
  const score=checks.filter(Boolean).length;
  if(score>=5)return {level:"complete",label:"Données complètes",score};
  if(score>=3)return {level:"sufficient",label:"Données suffisantes",score};
  return {level:"incomplete",label:"Données à compléter",score};
}

function mutationIdentity(tx){
  return tx?.mutationId||[tx?.date,tx?.value,tx?.address,tx?.builtArea].join("|");
}
function sameAddressForRadar(property,tx){
  const a=addressParts(property),b=addressParts(tx);
  const sameCommune=(a.cityCode&&b.cityCode&&a.cityCode===b.cityCode)||(a.postal&&b.postal&&a.postal===b.postal);
  return Boolean(sameCommune && a.fullAddress && b.fullAddress && a.fullAddress===b.fullAddress);
}
function confirmedSaleHistory(property,match){
  const exact=match?.matchQuality==="exact";
  const strong=exact && (match?.unitConfidence==="probable" || (match?.unitConfidence==="unknown" && (match?.txs?.length||0)===1));
  if(!strong){
    return {
      status:exact?"ambiguous":"none",
      count:0,
      latest:null,
      first:null,
      totalValue:0,
      reason:exact?(match?.unitReason||"Adresse exacte mais logement non isolé"):"Aucune vente DVF à la même adresse"
    };
  }
  const txs=Array.from(match?.txs||[])
    .filter(tx=>tx?.date&&Number.isFinite(new Date(tx.date).getTime())&&Number(tx?.value)>0)
    .sort((a,b)=>new Date(a.date)-new Date(b.date));
  const latest=txs[txs.length-1]||null;
  const first=txs[0]||null;
  return {
    status:txs.length?"confirmed":"none",
    count:txs.length,
    latest:latest?{
      date:latest.date,value:latest.value,type:latest.type,builtArea:latest.builtArea,
      carrezArea:latest.carrezArea,landArea:latest.landArea,rooms:latest.rooms
    }:null,
    first:first?{date:first.date,value:first.value}:null,
    totalValue:txs.reduce((sum,tx)=>sum+Number(tx.value||0),0),
    reason:txs.length?"Vente(s) DVF confirmée(s) à la même adresse":"Aucune vente DVF exploitable à la même adresse"
  };
}
function radarSaleAgeScore(ageYears){
  if(ageYears===null)return 0;
  if(ageYears>=10)return 15;
  if(ageYears>=5)return 12;
  if(ageYears>=2)return 8;
  if(ageYears>=1)return 4;
  return 1;
}
function radarHistoryScore(count){
  if(count>=4)return 15;
  if(count===3)return 12;
  if(count===2)return 8;
  if(count===1)return 4;
  return 0;
}

function radarDpeOpportunityScore(p){
  const grade=String(p?.dpe||"").toUpperCase();
  if(grade==="G")return 15;
  if(grade==="F")return 14;
  if(grade==="E")return 11;
  if(grade==="D")return 6;
  return 0;
}
function radarDpeFreshnessScore(p){
  const rawDate=p?.date?new Date(p.date).getTime():NaN;
  const age=Number.isFinite(rawDate)?Math.max(0,(Date.now()-rawDate)/86400000/365.25):Number(p?.dpeAgeYears);
  if(!Number.isFinite(age))return 0;
  if(age<=1)return 10;
  if(age<=3)return 8;
  if(age<=5)return 5;
  return 2;
}
function radarSellerOpportunity(p,parts){
  const saleAge=Math.max(0,Math.min(15,Number(parts?.saleAgeScore)||0));
  const typeSurface=Math.max(0,Math.min(15,Number(parts?.typeSurfaceScore)||0));
  const terrain=Math.max(0,Math.min(5,Number(parts?.terrainScore)||0));
  const dpe=Math.max(0,Math.min(20,radarDpeOpportunityScore(p)));
  const dpeFresh=Math.max(0,Math.min(10,radarDpeFreshnessScore(p)));
  const proximity=Math.max(0,Math.min(15,Number(parts?.proximityScore)||0));
  const history=Math.max(0,Math.min(15,Number(parts?.historyScore)||0));
  const data=Math.max(0,Math.min(15,Number(parts?.dataScore)||0));

  // 4 familles : 30 + 20 + 25 + 25 = 100.
  const patrimonial=Math.round((saleAge+typeSurface+terrain));
  const renovation=Math.round(dpe);
  const market=Math.round((proximity+history)*(25/30));
  const quality=Math.round(Math.min(25,data+dpeFresh));

  // Bonus volontairement limité : il récompense les convergences sans laisser
  // un seul signal (notamment le DPE) dominer le classement.
  let bonus=0;
  if(dpe>=11 && saleAge>=8)bonus+=2;
  if(proximity>=8 && data>=9)bonus+=2;
  if(typeSurface>=8 && proximity>=8)bonus+=1;
  bonus=Math.min(5,bonus);

  const raw=patrimonial+renovation+market+quality+bonus;
  const score=Math.min(100,Math.round(raw));
  const reasons=[];
  const grade=String(p?.dpe||"").toUpperCase();
  if(grade==="G")reasons.push("DPE G · forte opportunité de rénovation");
  else if(grade==="F")reasons.push("DPE F · forte opportunité de rénovation");
  else if(grade==="E")reasons.push("DPE E · potentiel de rénovation");
  if(dpeFresh>=8)reasons.push("DPE récent");
  if(saleAge>=12)reasons.push("Dernière vente ancienne");
  else if(saleAge>=8)reasons.push("Dernière vente déjà ancienne");
  if(proximity>=10)reasons.push("Marché comparable bien documenté");
  else if(proximity>=5)reasons.push("Comparables locaux disponibles");
  if(typeSurface>=10)reasons.push("Type et surface bien comparables");
  else if(typeSurface>=5)reasons.push("Type/surface cohérents");
  if(history>=4)reasons.push("Historique DVF récurrent");
  if(quality>=7)reasons.push("Données fiables et complètes");

  let level="Surveillance";
  let action="⚪ Surveillance faible";
  if(score>=85){level="Potentiel très élevé";action="🔥 Priorité terrain";}
  else if(score>=75){level="Potentiel élevé";action="📞 À contacter en priorité";}
  else if(score>=60){level="Potentiel intéressant";action="👀 À surveiller activement";}
  else if(score>=40){level="Potentiel à étudier";action="🗺️ Couverture territoriale";}

  return {
    score,level,action,reasons:reasons.slice(0,5),
    components:{
      patrimonial:{score:patrimonial,max:30},
      renovation:{score:renovation,max:20},
      market:{score:market,max:25},
      quality:{score:quality,max:25}
    },
    bonus
  };
}
function radarSellerOpportunityScore(p,parts){
  return radarSellerOpportunity(p,parts).score;
}

function radarProspectionPriority(p,parts,sellerOpportunity,quality,comparable,match,saleHistory){
  // Priorité de travail terrain : solidité et exploitabilité du dossier,
  // pas une probabilité de vente et jamais une intention du propriétaire.
  p={...p,dpeConfirmed:parts?.dpeConfirmed,dpeAddressStatus:parts?.dpeAddressStatus};
  const potential=Math.min(25,Math.min(100,Number(sellerOpportunity?.score)||0)*0.25);
  const q=Math.max(0,Math.min(5,Number(quality?.score)||0));
  const dataQuality=Math.round((q/5)*20);

  let evidence=0;
  if(p?.dpeConfirmed===true || p?.dpeAddressStatus==="confirmed") evidence+=5;
  else if(p?.dpeAddressStatus==="uncertain") evidence+=2;
  if(saleHistory?.status==="confirmed") evidence+=5;
  else if(saleHistory?.status==="ambiguous") evidence+=2;
  if(match?.matchQuality==="exact" || match?.unitConfidence==="high") evidence+=5;
  else if(match?.matchQuality==="street" || match?.unitConfidence==="medium") evidence+=3;
  evidence=Math.min(15,evidence);

  const comparableCount=Number(comparable?.count)||0;
  const medianDistance=Number(comparable?.medianDistance);
  const dispersion=Number(comparable?.dispersion);
  let market=0;
  if(comparableCount>=10)market+=10;
  else if(comparableCount>=5)market+=7;
  else if(comparableCount>=2)market+=4;
  else if(comparableCount===1)market+=2;
  if(Number.isFinite(medianDistance)){
    if(medianDistance<=500)market+=5;
    else if(medianDistance<=1000)market+=3;
    else market+=1;
  }
  if(Number.isFinite(dispersion)){
    if(dispersion<=0.25)market+=5;
    else if(dispersion<=0.40)market+=3;
    else market+=1;
  }
  market=Math.min(20,market);

  let readiness=0;
  if(p?.address)readiness+=3;
  if(p?.postalCode)readiness+=2;
  if(p?.city)readiness+=2;
  if(Number.isFinite(Number(p?.longitude)) && Number.isFinite(Number(p?.latitude)) &&
     (Number(p.longitude)!==0 || Number(p.latitude)!==0))readiness+=3;
  if(p?.buildingType)readiness+=2;
  if(Number(p?.area)>0)readiness+=2;
  if(Number(p?.rooms)>0)readiness+=1;
  if(Number(p?.terrainArea)>0)readiness+=1;
  readiness=Math.min(20,readiness);

  const score=Math.min(100,potential+dataQuality+evidence+market+readiness);
  let level="Faible priorité",action="⚪ Surveillance";
  if(score>=85){level="Priorité terrain";action="🔥 À traiter sur le terrain";}
  else if(score>=70){level="Priorité prospection";action="📞 À préparer / contacter";}
  else if(score>=55){level="À traiter";action="👀 Vérification ciblée";}
  else if(score>=40){level="À préparer";action="🗺️ Compléter le dossier";}
  const reasons=[];
  if(potential>=20)reasons.push("Potentiel du bien élevé");
  if(dataQuality>=16)reasons.push("Données de bonne qualité");
  if(evidence>=10)reasons.push("Rapprochement DPE/DVF solide");
  if(market>=14)reasons.push("Comparables locaux exploitables");
  if(readiness>=15)reasons.push("Dossier prêt pour une vérification terrain");
  if(!reasons.length)reasons.push("Dossier à compléter avant déplacement");
  return {
    score,level,action,reasons:reasons.slice(0,4),
    components:{
      potential:{score:potential,max:25},
      dataQuality:{score:dataQuality,max:20},
      evidence:{score:evidence,max:15},
      market:{score:market,max:20},
      readiness:{score:readiness,max:20}
    },
    disclaimer:"Priorité de travail calculée à partir de la qualité et de l'exploitabilité des données publiques. Ce score ne constitue pas une probabilité de vente et ne permet pas d'inférer l'intention du propriétaire."
  };
}
function radarCommercialSignal(p){
  // Seuls des signaux explicitement documentés par une source publique donnent des points.
  // DPE, DVF, consommations ou informations privées ne créent jamais une intention de vente.
  const signals=[];
  const add=(key,label,points)=>signals.push({key,label,points});
  if(p.publicListingActive===true)add("activeListing","Annonce publique active",40);
  if(p.publicPriceDrop===true)add("priceDrop","Baisse de prix publique",30);
  if(p.publicListingReappeared===true)add("reappeared","Annonce publique réapparue",25);
  if(p.publicOldListing===true)add("oldListing","Annonce publique ancienne encore visible",15);
  if(p.publicProcedure===true)add("procedure","Procédure / vente immobilière publique",35);
  if(p.publicAuction===true)add("auction","Vente aux enchères / adjudication publique",40);
  if(p.publicLandSale===true)add("publicLandSale","Terrain publiquement proposé à la vente",25);
  const score=Math.min(100,signals.reduce((n,s)=>n+s.points,0));
  let level="Aucun signal commercial public";
  if(score>=65)level="Signal commercial public fort";
  else if(score>=35)level="Signal commercial public";
  else if(score>0)level="Signal commercial public faible";
  return {score,level,signals};
}
function radarDpeIdentity(p){
  const address=norm(p?.address||""),postal=norm(p?.postalCode||""),type=norm(p?.buildingType||"");
  const area=Number(p?.area)||0,rooms=Number(p?.rooms)||0;
  const building=norm(p?.buildingRef||""),apartment=norm(p?.apartmentRef||""),floor=norm(p?.floor||"");
  if(apartment)return ["unit",address,postal,building,apartment].join("|");
  if(building)return ["building",address,postal,building,area,rooms,floor,type].join("|");
  return ["fallback",address,postal,type,Math.round(area*10)/10,rooms,floor].join("|");
}
function dedupeRadarDpeRows(rows){
  const groups=new Map();
  for(const row of rows||[]){
    const key=radarDpeIdentity(row);
    if(!groups.has(key)){groups.set(key,row);continue}
    const current=groups.get(key);
    const currentDate=current?.date?new Date(current.date).getTime():0;
    const rowDate=row?.date?new Date(row.date).getTime():0;
    const fields=["address","postalCode","city","dpe","buildingType","area","date","buildingRef","apartmentRef"];
    const completeness=x=>fields.filter(k=>x?.[k]).length;
    if(rowDate>currentDate || (rowDate===currentDate && completeness(row)>completeness(current)))groups.set(key,row);
  }
  return Array.from(groups.values());
}
function radarPriorityLevel(score){
  if(score>=65)return "Priorité · signal public fort";
  if(score>=35)return "Priorité · signal public";
  if(score>0)return "À vérifier · signal public faible";
  return "Surveillance · aucun signal commercial public";
}
function radarDataScore(quality){
  return Math.min(15,Math.max(0,Number(quality?.score)||0)*3);
}
function radarTypeSurfaceScore(property,bestComparable){
  if(!bestComparable)return {score:0,reasons:[]};
  const reasons=[];let score=0;
  const pType=String(property?.buildingType||"").toLowerCase();
  const cType=String(bestComparable?.type||"").toLowerCase();
  const typeOk=(/maison|house/.test(pType)&&/maison|house/.test(cType))||(/appartement|appart|apartment/.test(pType)&&/appartement|appart|apartment/.test(cType));
  if(typeOk){score+=5;reasons.push("Type cohérent avec les comparables +5")}
  const ratio=Number(bestComparable?.surfaceRatio);
  if(Number.isFinite(ratio)){
    if(ratio<=0.08){score+=7;reasons.push("Surface comparable très proche +7")}
    else if(ratio<=0.15){score+=5;reasons.push("Surface comparable proche +5")}
    else if(ratio<=0.20){score+=3;reasons.push("Surface comparable acceptable +3")}
  }
  const pr=Number(property?.rooms)||0,cr=Number(bestComparable?.rooms)||0;
  if(pr>0&&cr>0){
    if(pr===cr){score+=3;reasons.push("Nombre de pièces identique +3")}
    else if(Math.abs(pr-cr)===1){score+=1;reasons.push("Nombre de pièces proche +1")}
  }
  return {score:Math.min(15,score),reasons};
}
function radarProximityScore(comparable){
  let score=0;
  const count=Number(comparable?.count)||0;
  if(count>=5)score+=8;else if(count>=3)score+=6;else if(count===2)score+=4;else if(count===1)score+=2;
  const d=Number(comparable?.medianDistance);
  if(Number.isFinite(d)){
    if(d<=100)score+=7;else if(d<=250)score+=5;else if(d<=500)score+=2;
  }
  return Math.min(15,score);
}
function radarTerrainScore(saleHistory){
  const area=Number(saleHistory?.latest?.landArea)||0;
  if(area>=1000)return 5;
  if(area>=300)return 3;
  if(area>0)return 1;
  return 0;
}
function groupPublicDvfRows(rows){
  const groups=new Map();
  for(const row of rows||[]){
    const mutation=String(row?.mutationId||"").trim();
    const address=norm(row?.address||"");
    const value=Number(row?.value)||0;
    const date=String(row?.date||"");
    const key=mutation
      ? "mutation|"+mutation+"|"+address
      : "fallback|"+date+"|"+address+"|"+value;
    if(!groups.has(key)){
      groups.set(key,{
        ...row,
        groupedCount:1,
        groupedTypes:[],
        groupedBuiltAreas:[],
        groupedLandAreas:[],
        groupedRooms:[]
      });
    }else{
      const g=groups.get(key);
      g.groupedCount++;
      if(!g.value&&value)g.value=value;
      if(!g.address&&row.address)g.address=row.address;
      if(!g.postalCode&&row.postalCode)g.postalCode=row.postalCode;
      if(!g.cityCode&&row.cityCode)g.cityCode=row.cityCode;
      if((Number(row.builtArea)||0)>(Number(g.builtArea)||0))g.builtArea=Number(row.builtArea)||0;
      if((Number(row.landArea)||0)>(Number(g.landArea)||0))g.landArea=Number(row.landArea)||0;
      if((Number(row.rooms)||0)>(Number(g.rooms)||0))g.rooms=Number(row.rooms)||0;
    }
    const g=groups.get(key);
    for(const [field,target] of [["type","groupedTypes"],["builtArea","groupedBuiltAreas"],["landArea","groupedLandAreas"],["rooms","groupedRooms"]]){
      const value=field==="type"?String(row?.[field]||"").trim():Number(row?.[field])||0;
      if(value && !g[target].includes(value))g[target].push(value);
    }
  }
  return Array.from(groups.values()).map(g=>({
    ...g,
    groupedTypes:g.groupedTypes.slice(0,8),
    groupedBuiltAreas:g.groupedBuiltAreas.filter(Number.isFinite).sort((a,b)=>a-b).slice(0,8),
    groupedLandAreas:g.groupedLandAreas.filter(Number.isFinite).sort((a,b)=>a-b).slice(0,8),
    groupedRooms:g.groupedRooms.filter(Number.isFinite).sort((a,b)=>a-b).slice(0,8)
  }));
}

async function api(pathname,url){
  if(pathname==="/api/health") return {ok:true,sources:{dpe:"ADEME",dvf:"DVF+ Cerema",geocoding:"Géoplateforme",chercherTrouver:"ChercherTrouver.immo"},server:"jml-prospection",version:"1.35.0"};
  if(pathname==="/api/integrations-health"){
    const ct=await fetchChercherTrouverPing();
    return {ok:ct.ok===true,checkedAt:new Date().toISOString(),chercherTrouver:ct};
  }
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
  if(pathname==="/api/geocode"){
    const q=url.searchParams.get("q")?.trim();
    if(!q)throw new Error("Paramètre q manquant");
    return {source:"BAN / Géoplateforme",results:await geocodeAddress(q,10)};
  }
  if(pathname==="/api/prospect-match"){
    const address=url.searchParams.get("address")?.trim();
    const city=url.searchParams.get("city")?.trim()||"";
    const postalCode=url.searchParams.get("postalCode")?.trim()||"";
    const type=url.searchParams.get("type")?.trim()||"Maison";
    const area=Number(url.searchParams.get("area"))||0;
    const rooms=Number(url.searchParams.get("rooms"))||0;
    const price=Number(url.searchParams.get("price"))||0;
    if(!address)throw new Error("Adresse du bien manquante");
    const query=[address,postalCode,city].filter(Boolean).join(", ");
    const geos=await geocodeAddress(query,5);
    const geo=geos[0];
    if(!geo)throw new Error("Adresse introuvable par la BAN / Géoplateforme");
    const property={
      address:geo.address||address,
      addressNumber:geo.housenumber||"",
      street:geo.street||"",
      postalCode:geo.postalCode||postalCode,
      city:geo.city||city,
      cityCode:geo.cityCode||"",
      longitude:geo.longitude,
      latitude:geo.latitude,
      buildingType:type,
      area,
      rooms
    };
    const propertyParts=addressParts(property);
    const dpeUrl=new URL(DPE_URL);
    dpeUrl.searchParams.set("q",property.address);
    dpeUrl.searchParams.set("size","100");
    const yearMin=String(Math.max(2021,DVF_GEO_LATEST_YEAR-4));
    const [dpeResult,dvfResult]=await Promise.allSettled([
      jsonFetch(dpeUrl),
      (async()=>{
        if(!property.cityCode) return {source:"DVF indisponible · code INSEE absent",rows:[]};
        try{
          const rows=await fetchDvfPaginated(DVF_URL,{codeInsee:property.cityCode,yearMin,yearMax:String(DVF_GEO_LATEST_YEAR),maxRows:10000});
          return {source:"DVF+ Cerema · jusqu'à 10 000 transactions",rows:rows.map(normalizeDvf)};
        }catch(e){
          const rows=await dvfGeoOpenData({codeInsee:property.cityCode,yearMin,yearMax:String(DVF_GEO_LATEST_YEAR),limit:10000});
          return {source:"DVF open-data · data.gouv.fr",fallback:true,rows:rows.map(x=>normalizeDvf({
            id_mutation:first(x,["id_mutation"]),date_mutation:first(x,["date_mutation"]),
            valeur_fonciere:first(x,["valeur_fonciere"]),code_type_local:first(x,["code_type_local"]),
            type_local:first(x,["type_local"]),surface_reelle_bati:first(x,["surface_reelle_bati"]),
            surface_terrain:first(x,["surface_terrain"]),code_commune:first(x,["code_commune"]),
            code_departement:first(x,["code_departement"]),adresse_numero:first(x,["adresse_numero"]),
            adresse_nom_voie:first(x,["adresse_nom_voie"]),code_postal:first(x,["code_postal"]),
            longitude:first(x,["longitude","lon"]),latitude:first(x,["latitude","lat"]),
            nombre_pieces_principales:first(x,["nombre_pieces_principales"]),
            lot_1_surface_carrez:first(x,["lot_1_surface_carrez"])
          }))};
        }
      })()
    ]);
    const dpeRaw=dpeResult.status==="fulfilled"?(Array.isArray(dpeResult.value?.results)?dpeResult.value.results:Array.isArray(dpeResult.value?.data)?dpeResult.value.data:[]):[];
    const dpeRows=dpeRaw.map(normalizeDpe);
    const dvfPack=dvfResult.status==="fulfilled"?dvfResult.value:{source:"DVF indisponible",rows:[]};
    const dvfRows=dvfPack.rows||[];
    const indexes=buildDvfIndexes(dvfRows);
    const dvfMatch=findDvfMatches(property,indexes);
    const dpeScored=dpeRows.map(p=>{
      const a=addressParts(p);
      let status="none";
      if(propertyParts.fullAddress&&a.fullAddress===propertyParts.fullAddress&&(propertyParts.cityCode&&a.cityCode===propertyParts.cityCode||propertyParts.postal&&a.postal===propertyParts.postal))status="confirmed";
      else if(propertyParts.street&&a.street===propertyParts.street&&((propertyParts.cityCode&&a.cityCode===propertyParts.cityCode)||(propertyParts.postal&&a.postal===propertyParts.postal)))status="uncertain";
      else if(propertyParts.point&&a.point&&distanceMeters(propertyParts.point,a.point)!==null&&distanceMeters(propertyParts.point,a.point)<=80)status="uncertain";
      return {...p,dpeAddressStatus:status};
    }).filter(p=>p.dpeAddressStatus!=="none");
    const dpeConfirmed=dpeScored.filter(p=>p.dpeAddressStatus==="confirmed");
    const comparable=localComparables(property,dvfRows);
    const score={
      dpe:dpeConfirmed.length?18:0,
      dvf:dvfMatch.matchQuality==="exact"?25:dvfMatch.matchQuality==="street"?12:dvfMatch.matchQuality==="proximity"?5:0
    };
    return {
      source:"Annonce particulier publique + BAN + DVF + DPE",
      property:{...property,price},
      geocode:geo,
      dpe:{
        status:dpeConfirmed.length?"confirmed":(dpeScored.length?"uncertain":"none"),
        confirmedCount:dpeConfirmed.length,
        candidates:dpeScored.slice(0,20).map(p=>({
          dpeNumber:p.dpeNumber,address:p.address,postalCode:p.postalCode,city:p.city,dpe:p.dpe,ges:p.ges,
          area:p.area,date:p.date,latitude:p.latitude,longitude:p.longitude,dpeAddressStatus:p.dpeAddressStatus
        }))
      },
      dvf:{
        status:dvfMatch.matchQuality,
        reason:dvfMatch.matchReason,
        matchedCount:dvfMatch.txs?.length||0,
        source:dvfPack.source,
        fallback:Boolean(dvfPack.fallback),
        transactions:(dvfMatch.txs||[]).slice(0,30).map(tx=>({
          mutationId:tx.mutationId,date:tx.date,value:tx.value,type:tx.type,builtArea:tx.builtArea,
          landArea:tx.landArea,rooms:tx.rooms,address:tx.address,latitude:tx.latitude,longitude:tx.longitude,
          distanceMeters:distanceMeters(propertyParts.point,pointOf(tx))
        }))
      },
      comparables:{
        count:comparable.count,medianPriceM2:comparable.medianPriceM2,radius:comparable.radius,
        dispersion:comparable.dispersion,items:(comparable.items||[]).slice(0,20)
      },
      score,
      disclaimer:"La carte rapproche une annonce publique fournie par l'utilisateur avec des données immobilières publiques. Elle n'identifie pas automatiquement le propriétaire."
    };
  }
  if(pathname==="/api/address-candidates"){
    const lat=Number(url.searchParams.get("lat")),lon=Number(url.searchParams.get("lon"));
    const area=Number(url.searchParams.get("area"))||0,rooms=Number(url.searchParams.get("rooms"))||0;
    const dpe=String(url.searchParams.get("dpe")||"").trim().toUpperCase();
    const cityCode=String(url.searchParams.get("cityCode")||"").trim();
    const listingUrl=String(url.searchParams.get("listingUrl")||"").trim();
    const listingTitle=String(url.searchParams.get("title")||"").trim();
    const listingCity=String(url.searchParams.get("city")||"").trim();
    const listingPostal=String(url.searchParams.get("postalCode")||"").trim();

    // Si l'annonce n'a pas de GPS, on tente d'abord de lire uniquement les
    // informations d'adresse publiquement présentes sur la page de l'annonce.
    let searchAddress="";
    if((!Number.isFinite(lat)||!Number.isFinite(lon))&&listingUrl){
      try{
        const u=new URL(listingUrl);
        const r=await fetch(u,{headers:{"User-Agent":"JML-Prospection-public/1.0","Accept":"text/html,application/xhtml+xml"},redirect:"follow"});
        if(r.ok){
          const html=await r.text();
          const candidates=[];
          for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\\s\\S]*?)<\/script>/gi)){
            try{
              const raw=m[1].trim().replace(/<!--|-->/g,"");
              const data=JSON.parse(raw);
              const nodes=Array.isArray(data)?data:(Array.isArray(data?.["@graph"])?data["@graph"]:[data]);
              for(const node of nodes){
                const a=node?.address;
                if(typeof a==="string")candidates.push(a);
                else if(a&&typeof a==="object"){
                  const text=[a.streetAddress,a.postalCode,a.addressLocality].filter(Boolean).join(", ");
                  if(text)candidates.push(text);
                }
              }
            }catch{}
          }
          const plain=String(html).replace(/<script[\\s\\S]*?<\/script>/gi," ").replace(/<style[\\s\\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\\s+/g," ");
          const postalMatch=plain.match(/\\b(08\\d{3})\\b/);
          const streetMatch=plain.match(/\\b\\d{1,4}\\s+(?:rue|avenue|av\\.|boulevard|bd\\.|chemin|impasse|place|allée|route|faubourg|quai)\\s+[^,.;]{3,80}/i);
          if(streetMatch)candidates.push(streetMatch[0]);
          if(postalMatch&&listingCity)candidates.push(postalMatch[1]+" "+listingCity);
          searchAddress=candidates.find(x=>/\\d/.test(x)&&/(08\\d{3}|rue|avenue|boulevard|chemin|impasse|place|route|allée|faubourg|quai)/i.test(x))||"";
        }
      }catch{}
    }

    if(!Number.isFinite(lat)||!Number.isFinite(lon)){
      if(!searchAddress && listingCity)searchAddress=[listingPostal,listingCity].filter(Boolean).join(" ");
      if(searchAddress){
        const geo=await geocodeAddress(searchAddress,8);
        const candidates=geo.map(g=>({
          address:g.address,postalCode:g.postalCode,city:g.city,cityCode:g.cityCode,street:g.street,number:g.housenumber,
          latitude:g.latitude,longitude:g.longitude,banId:g.banId,
          distanceMeters:0,score:Math.round((g.score||0)*100),geoScore:0,
          surfaceRatio:null,surfaceCompatible:true,confidence:(g.score||0)>=.75?"interessante":"a_verifier",
          priority:"a_verifier",reasons:["Adresse/zone extraite de la page publique ou de la commune","Géocodage BAN"],
          bdnb:[],dpe:null
        }));
        return {source:"Page publique + BAN",candidates:candidates.slice(0,5),disclaimer:"Adresse candidate issue uniquement d'informations publiques. Vérification nécessaire avant toute utilisation terrain."};
      }
      return {source:"Page publique + BAN",candidates:[],disclaimer:"Aucune adresse publique suffisamment documentée dans l'annonce. La commune seule ne permet pas d'identifier une adresse."};
    }

    const lat=Number(url.searchParams.get("lat")),lon=Number(url.searchParams.get("lon"));
    const area=Number(url.searchParams.get("area"))||0,rooms=Number(url.searchParams.get("rooms"))||0;
    const dpe=String(url.searchParams.get("dpe")||"").trim().toUpperCase();
    const cityCode=String(url.searchParams.get("cityCode")||"").trim();
    if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("Coordonnées de l'annonce manquantes");
    const reverseUrl=new URL("https://data.geopf.fr/geocodage/reverse");
    reverseUrl.searchParams.set("lat",String(lat));reverseUrl.searchParams.set("lon",String(lon));
    reverseUrl.searchParams.set("index","address");reverseUrl.searchParams.set("limit","15");reverseUrl.searchParams.set("type","housenumber");
    if(cityCode)reverseUrl.searchParams.set("citycode",cityCode);
    const reverse=await jsonFetch(reverseUrl);
    let features=Array.isArray(reverse?.features)?reverse.features:[];
    // Secours BAN/Geoplateforme : certaines coordonnées d'annonces tombent entre
    // deux adresses ou sur une position qui n'est pas indexée comme housenumber.
    // On élargit alors la recherche aux localisants d'adresse proches.
    if(!features.length){
      try{
        const broad=new URL("https://data.geopf.fr/geocodage/reverse");
        broad.searchParams.set("lat",String(lat));broad.searchParams.set("lon",String(lon));
        broad.searchParams.set("index","address");broad.searchParams.set("limit","15");
        if(cityCode)broad.searchParams.set("citycode",cityCode);
        const b=await jsonFetch(broad);
        features=Array.isArray(b?.features)?b.features:[];
      }catch{}
    }
    const candidates=features.map(f=>{
      const p=f?.properties||{},c=f?.geometry?.coordinates||[];
      return {address:p.label||"",postalCode:p.postcode||"",city:p.city||"",cityCode:p.citycode||"",street:p.street||"",number:p.housenumber||"",latitude:Number(c[1])||0,longitude:Number(c[0])||0,banId:p.id||"",distanceMeters:distanceMeters(pointOf({latitude:lat,longitude:lon}),pointOf({latitude:Number(c[1])||0,longitude:Number(c[0])||0}))};
    }).filter(x=>x.address&&x.latitude&&x.longitude);
    const enriched=await Promise.all(candidates.slice(0,8).map(async c=>{
      const bdnb=await fetchBdnbAddress(c.address,c.city);
      const dpes=await fetchDpeCandidates(c.address,c.city);
      const bestDpe=dpes.map(d=>({d,dist:distanceMeters(pointOf(c),pointOf(d))}))
        .sort((a,b)=>a.dist-b.dist)[0]?.d||null;
      // Calibration terrain V1.19.7 :
      // la proximité géographique est le signal principal pour retrouver une adresse.
      // Une discordance de surface DPE doit rester un avertissement, pas annuler une
      // candidate géographiquement très proche. Le DPE peut décrire une autre unité,
      // une ancienne configuration ou une surface différente du bien annoncé.
      let score=0,reasons=[];
      let geoScore=0;
      if(c.distanceMeters<=50){geoScore=35;reasons.push("Coordonnées très proches +35")}
      else if(c.distanceMeters<=100){geoScore=30;reasons.push("Coordonnées proches +30")}
      else if(c.distanceMeters<=200){geoScore=22;reasons.push("Coordonnées compatibles +22")}
      else if(c.distanceMeters<=400){geoScore=12;reasons.push("Coordonnées éloignées +12")}
      else if(c.distanceMeters<=600){geoScore=4;reasons.push("Coordonnées éloignées +4")}
      score+=geoScore;
      if(bdnb.length){ score+=20; reasons.push("BDNB bâtiment retrouvé +20"); }

      let surfaceCompatible=true;
      let surfaceRatio=null;
      if(bestDpe){
        const da=Number(bestDpe.area)||0;
        if(area>0&&da>0){
          surfaceRatio=Math.abs(da-area)/area;
          if(surfaceRatio<=.05){score+=30;reasons.push("Surface DPE très proche +30")}
          else if(surfaceRatio<=.10){score+=24;reasons.push("Surface DPE proche +24")}
          else if(surfaceRatio<=.20){score+=14;reasons.push("Surface DPE compatible +14")}
          else if(surfaceRatio<=.30){score-=3;reasons.push("Surface DPE assez différente -3");surfaceCompatible=false}
          else {score-=8;reasons.push("Surface DPE discordante -8");surfaceCompatible=false}
        }
        if(dpe&&bestDpe.dpe&&dpe===String(bestDpe.dpe).toUpperCase()&&surfaceCompatible){score+=15;reasons.push("DPE identique +15")}
        if(rooms>0&&bestDpe.rooms>0){
          if(rooms===bestDpe.rooms&&surfaceCompatible){score+=15;reasons.push("Pièces identiques +15")}
          else if(Math.abs(rooms-bestDpe.rooms)===1&&surfaceCompatible){score+=8;reasons.push("Pièces proches +8")}
          else if(Math.abs(rooms-bestDpe.rooms)>1&&surfaceCompatible===false){reasons.push("Pièces non utilisées : surface DPE discordante")}
          else if(Math.abs(rooms-bestDpe.rooms)>1){score-=10;reasons.push("Nombre de pièces différent -10")}
        }
      }

      const finalScore=Math.max(0,Math.min(100,score));
      // Calibration V1.20.4 :
      // "forte" exige désormais une concordance réellement solide.
      // Une bonne proximité seule ne suffit plus à afficher un résultat vert.
      const confidence=
        geoScore>=30 && surfaceCompatible && finalScore>=70 ? "forte" :
        finalScore>=50 ? "interessante" :
        finalScore>=35 ? "a_verifier" : "faible";
      const priority=
        geoScore>=35 && !surfaceCompatible ? "priorite_geographique" :
        confidence==="forte" ? "concordance_forte" :
        confidence==="interessante" ? "concordance_interessante" :
        confidence==="a_verifier" ? "a_verifier" : "faible";

      return {
        ...c,
        score:finalScore,
        geoScore,
        surfaceRatio,
        surfaceCompatible,
        confidence,
        priority,
        reasons,
        bdnb:bdnb.slice(0,5).map(x=>({buildingId:x.batiment_groupe_id||"",address:x.libelle_adr_principale_ban||"",banKey:x.cle_interop_adr||"",dpeId:x.identifiant_dpe||"",units:Number(x.nb_log)||0})),
        dpe:bestDpe?{
          address:bestDpe.address,
          area:bestDpe.area,
          rooms:bestDpe.rooms,
          dpe:bestDpe.dpe,
          buildingType:bestDpe.buildingType,
          distanceMeters:distanceMeters(c,bestDpe)
        }:null
      };
    }));
    enriched.sort((a,b)=>b.score-a.score||a.distanceMeters-b.distanceMeters);
    return {source:"Géoplateforme BAN + ADEME DPE",candidates:enriched.slice(0,5),disclaimer:"Adresses candidates issues de données publiques. Le score est une concordance technique et ne constitue pas une confirmation d'adresse ni une identification de propriétaire."};
  }
  if(pathname==="/api/sector-tour"){
    const dept=String(url.searchParams.get("dept")||"08").trim();
    const type=String(url.searchParams.get("type")||"").trim();
    const minCount=Math.max(5,Math.min(15,Number(url.searchParams.get("min")||10)));
    const maxRadiusKm=Math.max(5,Math.min(30,Number(url.searchParams.get("maxRadius")||20)));
    const freshDays=Math.max(1,Math.min(30,Number(url.searchParams.get("freshDays")||7))); const created_since=new Date(Date.now()-freshDays*86400000).toISOString(); const data=await fetchChercherTrouver({dept,transaction:"vente",sort:"recent",created_since,page_size:"100",...(type?{type}:{})});
    const raw=Array.isArray(data.items)?data.items:[];
    const isPrivate=(p)=>{
      const seller=String(p.seller_type||p.sellerType||p.advertiser_type||"").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");
      const pro=["pro","professionnel","agence","agency","mandataire","promoteur","notaire"].some(x=>seller===x||seller.includes(x));
      const exclusive=p.exclusive===true||p.exclusive==="true"||p.exclusivity===true||p.exclusivity==="true";
      return !pro&&!exclusive;
    };
    const includePro=String(url.searchParams.get("includePro")||"true")!=="false"; const eligibleItems=(includePro?raw:raw.filter(isPrivate)).map(p=>({...p,
      latitude:Number(p.latitude??p.lat),longitude:Number(p.longitude??p.lon)
    })).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
    const hav=(a,b,c,d)=>{
      const R=6371,rad=x=>x*Math.PI/180;
      const x=rad(c-a),y=rad(d-b),aa=Math.sin(x/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(y/2)**2;
      return 2*R*Math.asin(Math.min(1,Math.sqrt(aa)));
    };
    const updatedMs=p=>{const d=Date.parse(p.updated_at||p.updatedAt||p.published_at||p.publishedAt||"");return Number.isFinite(d)?d:0};
    let best=null;
    for(const center of eligibleItems){
      const within=eligibleItems.map(p=>({...p,_distanceKm:hav(center.latitude,center.longitude,p.latitude,p.longitude)}))
        .filter(p=>p._distanceKm<=maxRadiusKm)
        .sort((a,b)=>a._distanceKm-b._distanceKm||updatedMs(b)-updatedMs(a));
      const chosen=within.slice(0,minCount);
      if(chosen.length<minCount) continue;
      const maxDist=chosen.reduce((m,p)=>Math.max(m,p._distanceKm),0);
      const avgDist=chosen.reduce((s,p)=>s+p._distanceKm,0)/chosen.length;
      const freshness=chosen.reduce((s,p)=>s+(Date.now()-updatedMs(p)<=7*86400000?1:0),0);
      const score=chosen.length*100 - avgDist*8 - maxDist*3 + freshness*4;
      if(!best||score>best.score)best={center,items:chosen,score,maxDist,avgDist};
    }
    const resultItems=(best?.items||eligibleItems.sort((a,b)=>updatedMs(b)-updatedMs(a)).slice(0,minCount))
      .map(p=>({...p,distanceKm:best?Number(p._distanceKm.toFixed(1)):null}));
    return {
      source:"ChercherTrouver.immo",
      target:minCount,
      found:resultItems.length,
      enough:resultItems.length>=minCount,
      search:{department:dept,type:type||"Tous",received:raw.length,eligible:eligibleItems.length,private:raw.filter(isPrivate).length,professional:raw.filter(p=>!isPrivate(p)).length,freshDays,maxRadiusKm},
      sector:best?{
        center:{city:best.center.city||"",postalCode:best.center.postal_code||"",latitude:best.center.latitude,longitude:best.center.longitude},
        maxDistanceKm:Number(best.maxDist.toFixed(1)),
        averageDistanceKm:Number(best.avgDist.toFixed(1))
      }:null,
      items:resultItems,
      hasMore:Boolean(data.hasMore),
      nextCursor:data.nextCursor||null,
      warning:resultItems.length<minCount
        ?"Moins de "+minCount+" annonces exploitables ont été reçues dans cette fenêtre API. Aucun bien n'a été artificiellement ajouté pour atteindre le quota."
        :null
    };
  }

  if(pathname==="/api/sources-health"){
    const ctKey=Boolean(String(process.env.CHERCHERTROUVER_API_KEY||"").trim());
    const stream=await pingStreamEstate();
    return {
      checkedAt:new Date().toISOString(),
      sources:[
        {id:"cherchertrouver",label:"ChercherTrouver.immo",kind:"annonces",configured:ctKey,ok:null,mode:"API agrégée"},
        {id:"streamestate",label:"Stream Estate",kind:"annonces",configured:stream.configured,ok:stream.ok,error:stream.error||null,mode:"API agrégée"},
        {id:"moteurimmo",label:"MoteurImmo",kind:"annonces",configured:Boolean(String(process.env.MOTEURIMMO_API_KEY||"").trim()),ok:null,mode:"API à connecter"},
        {id:"yanport",label:"Yanport",kind:"annonces + marché",configured:Boolean(String(process.env.YANPORT_API_KEY||"").trim()),ok:null,mode:"API à connecter"},
        {id:"casafari",label:"CASAFARI",kind:"annonces + marché",configured:Boolean(String(process.env.CASAFARI_API_KEY||"").trim()),ok:null,mode:"API à connecter"},
        {id:"dpe",label:"ADEME DPE",kind:"enrichissement",configured:true,ok:true,mode:"Open data"},
        {id:"dvf",label:"DVF+ / Cerema",kind:"transactions",configured:true,ok:true,mode:"Open data"},
        {id:"ban",label:"BAN / Géoplateforme",kind:"geocodage",configured:true,ok:true,mode:"Open data"},
        {id:"georisques",label:"Géorisques",kind:"risques",configured:true,ok:true,mode:"Open data à enrichir"}
      ]
    };
  }
  if(pathname==="/api/annonces-multi"){
    const params={};
    for(const key of ["q","type","transaction","ville","cp","dept","prix_min","prix_max","surface_min","created_since","updated_since"]){
      const value=url.searchParams.get(key);if(value)params[key]=value;
    }
    params.page_size=url.searchParams.get("page_size")||"50";
    const tasks=[
      (async()=>fetchChercherTrouver(params))(),
      (async()=>fetchStreamEstate(params))()
    ];
    const results=await Promise.allSettled(tasks);
    const items=[],sources=[];
    results.forEach((r,i)=>{
      const name=i===0?"ChercherTrouver.immo":"Stream Estate";
      if(r.status==="fulfilled"){
        const normalized=(r.value.items||[]).map(p=>({...p,source:p.source||name,sources:Array.isArray(p.sources)&&p.sources.length?p.sources:[{source:name,reference:p.reference||"",url:p.external_url||""}]}));
        sources.push({source:name,ok:true,count:normalized.length});items.push(...normalized)
      }
      else sources.push({source:name,ok:false,error:r.reason?.message||"erreur",count:0});
    });

    // Secours gratuit : si ChercherTrouver est bloqué par quota/clé absente,
    // utiliser des pages publiques configurées et autorisées.
    const ctFailed=sources.some(x=>x.source==="ChercherTrouver.immo"&&!x.ok);
    // Le web public gratuit complète désormais le catalogue, même lorsqu'une API renvoie déjà des résultats.
    // On limite volontairement à 3 sources locales pour ne pas ralentir la recherche.
    if(ctFailed || items.length<50){
      try{
        const free=await searchFreeWebListings({...params,web_sources:3});
        sources.push({source:"Web public local",ok:true,count:free.items?.length||0,details:"Secours gratuit · pages publiques autorisées"});
        items.push(...(free.items||[]));
      }catch(e){
        sources.push({source:"Web public local",ok:false,count:0,error:e.message||"erreur"});
      }
    }

    const seen=new Set(),deduped=[];
    for(const p of items){
      const sourceKey=Array.isArray(p.sources)&&p.sources.length
        ? p.sources.map(x=>x.url||x.reference||x.source||"").sort().join(",")
        : "";
      const key=String(p.dedup_key||p.reference||p.external_url||sourceKey)+"|"+String(p.city||"")+"|"+Number(p.price||0)+"|"+Number(p.surface||0);
      if(!seen.has(key)){seen.add(key);deduped.push(p)}
    }
    return {source:"JML multi-sources",total:deduped.length,items:deduped,sources};
  }
  if(pathname==="/api/annonces"){
    const params={};
    for(const key of ["q","type","transaction","ville","cp","dept","region","prix_min","prix_max","prix_m2_min","prix_m2_max","created_since","updated_since","sort","source","sources","exclude_sources","cursor"]){
      const value=url.searchParams.get(key);
      if(value)params[key]=value;
    }
    params.page_size=url.searchParams.get("page_size")||"50";
    const data=await fetchChercherTrouver(params);
    return data;
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
  if(pathname==="/api/territory"){
    const department=String(url.searchParams.get("department")||"08").trim();
    const communes=await getDepartmentCommunes(department);
    const cities=communes.slice().sort((a,b)=>(b.population-a.population)||a.city.localeCompare(b.city,"fr"));
    return {
      department,
      label:department==="08"?"Ardennes":"Département "+department,
      communeCount:cities.length,
      communes:cities.map(x=>({city:x.city,cityCode:x.cityCode,postalCode:x.postalCode,population:x.population,point:x.point}))
    };
  }
  if(pathname==="/api/radar-zone"){
    let sectors=[];
    try{sectors=JSON.parse(url.searchParams.get("sectors")||"[]")}catch{}
    if(!Array.isArray(sectors)||!sectors.length)throw new Error("Aucun secteur de prospection sélectionné");
    const normalizedSectors=sectors.map((x,i)=>({id:String(x?.id||("secteur-"+(i+1))).trim(),label:String(x?.label||x?.q||("Secteur "+(i+1))).trim(),q:String(x?.q||x?.label||"").trim(),radiusKm:Math.max(1,Math.min(50,Number(x?.radiusKm)||15))})).filter(x=>x.q);
    if(!normalizedSectors.length)throw new Error("Les secteurs sélectionnés sont invalides");
    const resolvedSectors=[];
    for(const sector of normalizedSectors){
      const resolved=await resolveCommune(sector.q);
      if(!resolved?.cityCode)throw new Error("Commune introuvable pour le secteur : "+sector.q);
      resolvedSectors.push({...sector,city:resolved.city||sector.label,cityCode:resolved.cityCode,postalCode:resolved.postalCode||""});
    }
    const departments=Array.from(new Set(resolvedSectors.map(x=>String(x.cityCode).slice(0,2)).filter(Boolean)));
    const communeLists=await Promise.all(departments.map(getDepartmentCommunes));
    const allCommunes=communeLists.flat();
    const sectorPlans=resolvedSectors.map(sector=>({...sector,centerPoint:allCommunes.find(c=>c.cityCode===sector.cityCode)?.point||null}));
    for(const sector of sectorPlans){
      if(!sector.centerPoint){
        try{const geo=await geocodeAddress(sector.city+" "+(sector.postalCode||""),1);const g=geo?.[0];if(g?.longitude&&g?.latitude)sector.centerPoint={kind:"lonlat",x:g.longitude,y:g.latitude}}catch{}
      }
      if(!sector.centerPoint)throw new Error("Position géographique introuvable pour "+sector.city);
    }
    const communeMembership=new Map();
    for(const commune of allCommunes){
      const memberships=[];
      for(const sector of sectorPlans){
        const d=distanceMeters(sector.centerPoint,commune.point);
        if(d!==null&&d<=sector.radiusKm*1000)memberships.push({sectorId:sector.id,sectorLabel:sector.city+" + "+sector.radiusKm+" km",distanceKm:Math.round(d/100)/10});
      }
      if(memberships.length)communeMembership.set(commune.cityCode,memberships);
    }
    for(const sector of sectorPlans){
      if(!communeMembership.has(sector.cityCode))communeMembership.set(sector.cityCode,[{sectorId:sector.id,sectorLabel:sector.city+" + "+sector.radiusKm+" km",distanceKm:0}]);
    }
    const codes=Array.from(communeMembership.keys());
    const years=Number(url.searchParams.get("years"))||5;
    const perCommuneLimit=cleanLimit(url.searchParams.get("perCommuneLimit"),60);
    const offset=Math.max(0,Number(url.searchParams.get("offset"))||0);
    const communeBatch=Math.max(1,Math.min(8,Number(url.searchParams.get("communeBatch"))||8));
    const selectedCodes=codes.slice(offset,offset+communeBatch);
    const aggregate=[],errors=[];
    // Les appels par zone restent courts pour Render, mais quatre communes sont traitées en parallèle afin de réduire le temps total sans saturer le serveur.
    for(let i=0;i<selectedCodes.length;i+=4){
      const batch=selectedCodes.slice(i,i+4);
      const results=await Promise.allSettled(batch.map(code=>api("/api/radar",new URL("http://localhost/api/radar?codeInsee="+encodeURIComponent(code)+"&limit="+perCommuneLimit+"&years="+encodeURIComponent(years)))));
      results.forEach((rr,j)=>rr.status==="fulfilled"?aggregate.push({codeInsee:batch[j],data:rr.value}):errors.push({codeInsee:batch[j],error:rr.reason?.message||"Analyse indisponible"}));
    }
    const candidatesByKey=new Map();
    let dpeCount=0,dpeRawCount=0,dvfCount=0,dvfFallback=false;
    for(const pack of aggregate){
      const memberships=communeMembership.get(pack.codeInsee)||[];
      const data=pack.data||{};
      dpeCount+=Number(data.dpeCount)||0;
      dpeRawCount+=Number(data.dpeRawCount)||0;
      dvfCount+=Number(data.dvfCount)||0;
      dvfFallback=dvfFallback||Boolean(data.dvfFallback);
      for(const candidate of (data.results||[])){
        const point=(Number(candidate.longitude)||0)!==0&&(Number(candidate.latitude)||0)!==0?{kind:"lonlat",x:Number(candidate.longitude),y:Number(candidate.latitude)}:null;
        const exactMemberships=sectorPlans.map(sector=>{const d=point?distanceMeters(sector.centerPoint,point):null;return d!==null&&d<=sector.radiusKm*1000?{sectorId:sector.id,sectorLabel:sector.city+" + "+sector.radiusKm+" km",distanceKm:Math.round(d/100)/10}:null}).filter(Boolean);
        const selectedMemberships=point&&exactMemberships.length?exactMemberships:memberships;
        if(!selectedMemberships.length)continue;
        const key=radarDpeIdentity(candidate),existing=candidatesByKey.get(key);
        if(existing){
          const merged=[...(existing.zoneSectors||[]),...selectedMemberships];
          existing.zoneSectors=Array.from(new Map(merged.map(x=>[x.sectorId,x])).values());
          existing.sectorLabels=existing.zoneSectors.map(x=>x.sectorLabel);
          existing.sectorIds=existing.zoneSectors.map(x=>x.sectorId);
          existing.nearestSectorDistanceKm=Math.min(...existing.zoneSectors.map(x=>Number(x.distanceKm)).filter(Number.isFinite));
        }else{
          const copy={...candidate,zoneSectors:selectedMemberships};
          copy.sectorLabels=selectedMemberships.map(x=>x.sectorLabel);
          copy.sectorIds=selectedMemberships.map(x=>x.sectorId);
          copy.nearestSectorDistanceKm=Math.min(...selectedMemberships.map(x=>Number(x.distanceKm)).filter(Number.isFinite));
          candidatesByKey.set(key,copy);
        }
      }
    }
    const results=Array.from(candidatesByKey.values()).sort((a,b)=>
      (b.priorityScore-a.priorityScore)||
      (b.sellerOpportunityScore-a.sellerOpportunityScore)||
      (b.marketContextScore-a.marketContextScore)
    ).slice(0,cleanLimit(url.searchParams.get("limit"),100));
    const sectorSummary=sectorPlans.map(sector=>{
      const sectorCandidates=results.filter(x=>(x.sectorIds||[]).includes(sector.id));
      const communeCount=codes.filter(code=>(communeMembership.get(code)||[]).some(x=>x.sectorId===sector.id)).length;
      return {id:sector.id,label:sector.city+" + "+sector.radiusKm+" km",city:sector.city,radiusKm:sector.radiusKm,communeCount,candidateCount:sectorCandidates.length};
    });
    return {source:"ADEME + DVF · zone de prospection multi-secteurs",mode:"multi-sector",sectors:sectorSummary,communeCount:codes.length,communesAnalyzed:aggregate.length,failedCommunes:errors,dpeCount,dpeRawCount,dpeDuplicateCount:Math.max(0,dpeRawCount-dpeCount),dvfCount,dvfFallback,results,totalCandidatesBeforeLimit:candidatesByKey.size,offset,communeBatch,nextOffset:offset+selectedCodes.length,complete:offset+selectedCodes.length>=codes.length,totalCommuneCount:codes.length,processedCommuneCodes:selectedCodes,disclaimer:"Analyse par lots de communes pour éviter les expirations de requête. Les biens sont dédoublonnés à chaque lot puis fusionnés côté navigateur."};
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
    const zoneMode=url.searchParams.get("zoneMode")==="1";
    const dvfMaxRows=Math.max(500,Math.min(10000,Number(url.searchParams.get("dvfMaxRows"))||(zoneMode?2500:10000)));
    const dpeUrl=new URL(DPE_URL);
    dpeUrl.searchParams.set("code_insee_ban_eq",codeInsee);
    dpeUrl.searchParams.set("size",String(Math.min(100,limit)));
    const [dpeResult,dvfResult]=await Promise.allSettled([
      jsonFetch(dpeUrl),
      (async()=>{
        try{
          if(zoneMode){
            const localRows=await dvfLocalOpenData({codeInsee,yearMin,yearMax,limit:dvfMaxRows});
            if(localRows)return {source:"DVF Ardennes local · zone rapide",fallback:true,rows:localRows.map(normalizeDvf)};
          }
          const rows=await fetchDvfPaginated(DVF_URL,{codeInsee,yearMin,yearMax,maxRows:dvfMaxRows});
          return {source:"DVF+ Cerema · pagination",rows:rows.map(normalizeDvf)};
        }catch(e){
          const rows=await dvfGeoOpenData({codeInsee,yearMin,yearMax,limit:dvfMaxRows});
          return {source:"DVF open-data · data.gouv.fr",fallback:true,rows:rows.map(x=>({mutationId:first(x,["id_mutation"]),date:first(x,["date_mutation"]),year:(first(x,["date_mutation"])||"").slice(0,4),natureMutation:first(x,["nature_mutation","libnatmut"]),value:Number(first(x,["valeur_fonciere"]))||0,typeCode:first(x,["code_type_local"]),type:first(x,["type_local"]),builtArea:Number(first(x,["surface_reelle_bati"]))||0,landArea:Number(first(x,["surface_terrain"]))||0,cityCode:first(x,["code_commune"]),department:first(x,["code_departement"]),address:[first(x,["adresse_numero"]),first(x,["adresse_nom_voie"])].filter(Boolean).join(" "),
            addressNumber:first(x,["adresse_numero"]),
            street:first(x,["adresse_nom_voie"]),
            postalCode:first(x,["code_postal"]),
            longitude:Number(first(x,["longitude","lon"]))||0,
            latitude:Number(first(x,["latitude","lat"]))||0,
            rooms:Number(first(x,["nombre_pieces_principales"]))||0,
            carrezArea:Number(first(x,["lot_1_surface_carrez"]))||0,
            lotCount:Number(first(x,["nombre_lots"]))||0,
            source:"DVF open-data · data.gouv.fr"}))};
        }
      })()
    ]);
    if(dpeResult.status!=="fulfilled")throw new Error("ADEME DPE indisponible pour cette commune : "+(dpeResult.reason?.message||"erreur source"));
    const dpeData=dpeResult.value;
    const dpeRowsRaw=(Array.isArray(dpeData?.results)?dpeData.results:Array.isArray(dpeData?.data)?dpeData.data:[]).map(normalizeDpe);
    const dpeRows=dedupeRadarDpeRows(dpeRowsRaw);
    const dvf=dvfResult.status==="fulfilled"?dvfResult.value:{source:"DVF indisponible",rows:[]};
    const dvfRows=dvf.rows||[];
    const indexes=buildDvfIndexes(dvfRows);
    const candidates=dpeRows.map((p,index)=>{
      const match=findDvfMatches(p,indexes);
      const saleHistory=confirmedSaleHistory(p,match);
      const saleDate=saleHistory.latest?.date?new Date(saleHistory.latest.date):null;
      const saleAgeYears=saleDate&&Number.isFinite(saleDate.getTime())?Math.max(0,(Date.now()-saleDate.getTime())/86400000/365.25):null;

      // Séparation stricte : les mutations de la même adresse ne sont jamais
      // comptées comme « comparables à proximité ».
      const comparableRows=dvfRows.filter(tx=>!sameAddressForRadar(p,tx));
      const comparable=localComparables(p,comparableRows);
      const bestComparable=comparable.best;
      const quality=classifyDataQuality(p);

      const dpeAddressStatus=match.matchQuality==="exact"?"confirmed":(match.matchQuality==="none"?"none":"uncertain");
      const dpeConfirmed=dpeAddressStatus==="confirmed" && (
        match.unitConfidence==="probable" ||
        (match.unitConfidence==="unknown" && (match.txs?.length||0)===1)
      );

      const reasons=[];
      const dpeScore=dpeConfirmed
        ? (["F","G"].includes(p.dpe)?20:(p.dpe==="E"?12:(p.dpe==="D"?6:0)))
        : 0;
      if(dpeConfirmed){
        reasons.push("DPE "+(p.dpe||"—")+" confirmé à la même adresse +"+dpeScore);
      }else if(dpeAddressStatus==="uncertain"){
        reasons.push("DPE trouvé mais adresse/unité non confirmée · bonus DPE 0");
      }else{
        reasons.push("DPE non confirmé à la même adresse · bonus DPE 0");
      }

      const saleAgeScore=radarSaleAgeScore(saleAgeYears);
      if(saleHistory.status==="confirmed"){
        reasons.push("Dernière vente DVF confirmée : "+new Date(saleHistory.latest.date).toLocaleDateString("fr-FR")+" · "+Math.round(saleAgeYears||0)+" an(s) · +"+saleAgeScore);
      }else if(saleHistory.status==="ambiguous"){
        reasons.push("Adresse DVF exacte mais logement ambigu · vente à la même adresse non confirmée");
      }else{
        reasons.push("Aucune vente DVF confirmée à la même adresse");
      }

      const typeSurface=radarTypeSurfaceScore(p,bestComparable);
      reasons.push(...typeSurface.reasons);

      const terrainScore=radarTerrainScore(saleHistory);
      const terrainArea=Number(saleHistory.latest?.landArea)||0;
      if(terrainScore)reasons.push("Terrain documenté par la vente DVF : "+Math.round(terrainArea)+" m² +"+terrainScore);

      const proximityScore=radarProximityScore(comparable);
      if(comparable.count){
        reasons.push(comparable.count+" comparable(s) distinct(s) à proximité · distance médiane "+(comparable.medianDistance!==null?Math.round(comparable.medianDistance)+" m":"non disponible"));
      }else{
        reasons.push("Aucun comparable DVF distinct suffisamment proche");
      }

      const historyScore=radarHistoryScore(saleHistory.count);
      if(saleHistory.count>=2)reasons.push("Historique confirmé : "+saleHistory.count+" vente(s) DVF à la même adresse +"+historyScore);
      else if(saleHistory.count===1)reasons.push("1 vente DVF confirmée à la même adresse +"+historyScore);

      const dataScore=radarDataScore(quality);
      reasons.push((quality.label||"Qualité des données")+" · "+quality.score+"/5 · +"+dataScore);

      // Séparation stricte : contexte de marché ≠ signal commercial.
      const marketContextScore=Math.min(100,dpeScore+saleAgeScore+typeSurface.score+terrainScore+proximityScore+historyScore+dataScore);
      const commercialSignals=radarCommercialSignal(p);
      const commercialSignalScore=commercialSignals.score;
      const commercialSignalLevel=commercialSignals.level;
      // Le score principal devient une priorité de prospection : 70 % signal public + 30 % contexte marché.
      // Sans signal commercial public, le bien reste une cible de surveillance.
      const priorityScore=Math.round(commercialSignalScore*0.70+marketContextScore*0.30);
      const sellerOpportunity=radarSellerOpportunity(p,{
        saleAgeScore,typeSurfaceScore:typeSurface.score,terrainScore,proximityScore,historyScore,dataScore
      });
      const sellerOpportunityScore=sellerOpportunity.score;
      const priorityProspection=radarProspectionPriority(
        p,
        {dpeConfirmed,dpeAddressStatus},
        sellerOpportunity,
        quality,
        comparable,
        match,
        saleHistory
      );
      const priorityProspectionScore=priorityProspection.score;
      const priorityProspectionLevel=priorityProspection.level;
      const priorityProspectionAction=priorityProspection.action;
      const priorityProspectionReasons=priorityProspection.reasons;
      const priorityLevel=radarPriorityLevel(commercialSignalScore);
      const score=priorityScore;
      const methodScores={
        dpe:Math.round(dpeScore/20*100),
        saleAge:Math.round(saleAgeScore/15*100),
        typeSurface:Math.round(typeSurface.score/15*100),
        terrain:Math.round(terrainScore/5*100),
        proximity:Math.round(proximityScore/15*100),
        history:Math.round(historyScore/15*100),
        data:Math.round(dataScore/15*100),
        commercialSignal:commercialSignalScore
      };

      const sameAddressSale=saleHistory.status==="confirmed";
      const saleAgeYearsRounded=saleAgeYears!==null ? Math.round(saleAgeYears*10)/10 : null;
      const nearestComparableDistance=(comparable.items||[]).map(x=>Number(x.distanceMeters)).filter(Number.isFinite).sort((a,b)=>a-b)[0]??null;
      const historyDates=(match.txs||[]).map(tx=>tx.date).filter(Boolean).sort();
      return {
        id:"dpe-"+(p.dpeNumber||index)+"-"+codeInsee,
        address:p.address,postalCode:p.postalCode,city:p.city,cityCode:p.cityCode,area:p.area,longitude:p.longitude||0,latitude:p.latitude||0,
        dpe:p.dpe,ges:p.ges,dpeDate:p.date,buildingRef:p.buildingRef||"",apartmentRef:p.apartmentRef||"",floor:p.floor||"",
        residenceName:p.residenceName||"",banId:p.banId||"",
        dpeAgeYears:p.date?Math.round(Math.max(0,(Date.now()-new Date(p.date).getTime())/86400000/365.25)*10)/10:null,
        buildingType:p.buildingType||"",energyConsumption:p.energyConsumption||0,gesValue:p.gesValue||0,
        constructionYear:p.constructionYear||0,
        latestSale:saleHistory.latest,
        sameAddressSale:{
          status:saleHistory.status,count:saleHistory.count,latest:saleHistory.latest,first:saleHistory.first,
          totalValue:saleHistory.totalValue,ageYears:saleAgeYearsRounded,
          historyDates,reason:saleHistory.reason
        },
        history:{
          count:saleHistory.count,firstDate:saleHistory.first?.date||null,lastDate:saleHistory.latest?.date||null,
          durationYears:(saleHistory.first?.date&&saleHistory.latest?.date)?Math.round(Math.max(0,(new Date(saleHistory.latest.date)-new Date(saleHistory.first.date))/86400000/365.25)*10)/10:null
        },
        terrainArea:terrainArea||0,terrainSource:terrainArea?"DVF · même adresse":"none",
        matchQuality:match.matchQuality,matchReason:match.matchReason,
        dpeAddressStatus,dpeConfirmed,
        sameAddressSaleConfirmed:sameAddressSale,
        distanceMeters:bestComparable?.distanceMeters??null,
        matchDistanceMeters:match.distanceMeters??null,
        nearestComparableDistance,
        postalCandidateCount:match.postalCount||0,
        unitConfidence:match.unitConfidence||"not_applicable",unitReason:match.unitReason||"",
        matchedMutationCount:match.txs?.length||0,selectedMutationCount:match.selectedCount||0,
        comparableCount:comparable.count,comparableRadius:comparable.radius,
        comparableMedianPriceM2:comparable.medianPriceM2,comparableQ1:comparable.q1,comparableQ3:comparable.q3,
        comparableDispersion:comparable.dispersion,comparableMedianDistance:comparable.medianDistance,
        comparableRecentCount:comparable.recentCount,comparables:comparable.items,
        bestComparable,
        score,priorityScore,priorityLevel,sellerOpportunityScore,sellerOpportunityLevel:sellerOpportunity.level,sellerOpportunityAction:sellerOpportunity.action,sellerOpportunityReasons:sellerOpportunity.reasons,sellerOpportunityComponents:sellerOpportunity.components,sellerOpportunityBonus:sellerOpportunity.bonus,priorityProspectionScore,priorityProspectionLevel,priorityProspectionAction,priorityProspectionReasons,priorityProspectionComponents:priorityProspection.components,priorityProspectionDisclaimer:priorityProspection.disclaimer,marketContextScore,commercialSignalScore,commercialSignalLevel,commercialSignals:commercialSignals.signals,
        evidence:{
          commercialSignal:{score:commercialSignalScore,level:commercialSignalLevel,signals:commercialSignals.signals},
          dataQuality:{level:quality.level,label:quality.label,score:quality.score},
          dpe:{confirmed:dpeConfirmed,status:dpeAddressStatus,grade:p.dpe||null,points:dpeScore},
          sameAddressSale:{confirmed:sameAddressSale,status:saleHistory.status,count:saleHistory.count,lastDate:saleHistory.latest?.date||null,ageYears:saleAgeYearsRounded,points:saleAgeScore},
          typeSurface:{points:typeSurface.score,ratio:bestComparable?.surfaceRatio??null,type:p.buildingType||null},
          terrain:{area:terrainArea,points:terrainScore},
          proximity:{count:comparable.count,medianDistance:comparable.medianDistance,nearestDistance:nearestComparableDistance,points:proximityScore},
          history:{count:saleHistory.count,firstDate:saleHistory.first?.date||null,lastDate:saleHistory.latest?.date||null,points:historyScore}
        },
        reasons,
        dataQuality:quality,
        disclaimer:"Indice de contexte de marché transparent basé sur des données publiques. Il ne constitue pas un signal de vente. Un signal commercial n'est crédité que lorsqu'une source publique explicite le documente ; DPE, DVF et comparables seuls n'identifient pas une intention de vendre et n'identifient pas un propriétaire."
      };
    }).filter(x=>x.address).sort((a,b)=>(b.priorityScore-a.priorityScore)||(b.marketContextScore-a.marketContextScore)).slice(0,limit);
    return {source:"ADEME + DVF comparables locaux",codeInsee,dpeCount:dpeRows.length,dpeRawCount:dpeRowsRaw.length,dpeDuplicateCount:Math.max(0,dpeRowsRaw.length-dpeRows.length),dvfCount:dvfRows.length,dvfSource:dvf.source,dvfFallback:!!dvf.fallback,results:candidates};
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
      const sameCommune=tx=>{const t=addressParts(tx);return (parts.cityCode&&t.cityCode&&parts.cityCode===t.cityCode)||(parts.postal&&t.postal&&parts.postal===t.postal);};
      const uniqueTxs=arr=>Array.from(new Map((arr||[]).map(tx=>[tx.mutationId||String(tx.date||"")+"|"+String(tx.address||""),tx])).values());
      const exactCandidates=uniqueTxs([...(indexes.fullAddress.get(parts.fullAddress)||[]),...(indexes.numberStreet.get(parts.numberStreet)||[])]).filter(sameCommune).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
      const streetCandidates=uniqueTxs([...(indexes.streetCity.get(parts.streetCity)||[]),...(indexes.streetPostal.get(parts.streetPostal)||[])]).filter(sameCommune);
      const txs=exactCandidates;
      const streetTxs=streetCandidates;
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
    return {source:"ADEME DPE + DVF historique",codeInsee,years,yearMin,yearMax,dpeCount:dpeRows.length,dvfCount:(dvf.rows||[]).length,matched:observations.length,baseline,exactMatched,streetOnly,excludedRecent,exactMatchRate:observations.length?exactMatched/observations.length*100:0,latestDvfDate:latestDvfDate.toISOString().slice(0,10),cutoffDate:cutoff.toISOString().slice(0,10),metrics,observations,disclaimer:"Backtest rétrospectif corrigé : seules les observations ayant un horizon complet de 180 jours avant la dernière mutation DVF disponible sont évaluées. Une mutation positive doit correspondre à la même adresse (numéro + rue + commune/CP). Une correspondance de rue seule est informative mais ne compte pas comme vente à cette adresse. Le rapprochement exact utilise numéro + rue normalisés, avec contrôle commune/CP. Cela mesure une association historique, pas une probabilité future ni une identification de propriétaire."};
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
    const addressQuery=url.searchParams.get("address")?.trim()||"";
    const addressNeedle=norm(addressQuery.split(",")[0]);
    const filterAddressRows=(rows)=>addressNeedle
      ? rows.filter(x=>{
          const a=norm(x.address||"");
          return a && (a.includes(addressNeedle)||addressNeedle.includes(a));
        })
      : rows;
    try{
      const u=new URL(DVF_URL);
      u.searchParams.set("code_insee",codeInsee);
      u.searchParams.set("page_size",String(limit));
      u.searchParams.set("anneemut_min",yearMin);
      u.searchParams.set("anneemut_max",yearMax);
      if(type)u.searchParams.set("codtypbien",type);
      const data=await jsonFetch(u);
      const rows=Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
      const normalized=rows.map(normalizeDvf);
      const filtered=filterAddressRows(normalized);
      const grouped=groupPublicDvfRows(filtered);
      return {source:"DVF+ Cerema",codeInsee,total:Number(data?.count??data?.total)||rows.length,results:grouped,rawCount:rows.length,filteredCount:filtered.length,groupedCount:grouped.length,addressFilter:Boolean(addressNeedle)};
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
      const filtered=filterAddressRows(normalized);
      const grouped=groupPublicDvfRows(filtered);
      return {source:"DVF Ardennes / open-data",codeInsee,total:normalized.length,results:grouped,rawCount:normalized.length,filteredCount:filtered.length,groupedCount:grouped.length,fallback:true,addressFilter:Boolean(addressNeedle),primaryError:ceremaError.message};
    }
  }
  throw new Error("Route API inconnue");
}

function readJsonBody(req,maxBytes=90000){
  return new Promise((resolve,reject)=>{
    let size=0,body="";
    req.setEncoding("utf8");
    req.on("data",chunk=>{
      size+=Buffer.byteLength(chunk);
      if(size>maxBytes){reject(new Error("Requête IA trop volumineuse."));req.destroy();return;}
      body+=chunk;
    });
    req.on("end",()=>{
      try{resolve(body?JSON.parse(body):{})}catch{reject(new Error("JSON invalide"))}
    });
    req.on("error",reject);
  });
}

async function handle(req,res){
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET" && url.pathname.startsWith("/api/")){
    try{return send(res,200,await api(url.pathname,url))}
    catch(e){return send(res,502,{ok:false,error:e.message||"Erreur source publique"})}
  }
  if(req.method==="POST" && url.pathname==="/api/ai"){
    try{
      const body=await readJsonBody(req);
      const task=String(body?.task||"analyze").trim();
      const allowed=["analyze","why","call","report","followup","priority"];
      if(!allowed.includes(task))return send(res,400,{ok:false,error:"Tâche IA inconnue"});
      if(task==="priority"){
        if(!Array.isArray(body?.prospects))return send(res,400,{ok:false,error:"Liste de prospects manquante"});
        return send(res,200,await runAi({task,prospects:body.prospects}));
      }
      if(!body?.prospect||typeof body.prospect!=="object")return send(res,400,{ok:false,error:"Prospect manquant"});
      return send(res,200,await runAi({task,prospect:body.prospect,context:String(body?.context||"")}));
    }catch(e){return send(res,502,{ok:false,error:e.message||"Erreur IA"})}
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
const server=http.createServer(handle);
server.keepAliveTimeout=120000;
server.headersTimeout=125000;
server.listen(PORT,"0.0.0.0",()=>console.log("JML Prospection server listening on 0.0.0.0:"+PORT));