const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { searchPublicListings, geocodeAddress } = require("./src/sources");
const { buildMarketSnapshot } = require("./src/market-engine");

const VERSION = "2.0.0";
const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");

function send(res, status, payload, type = "application/json; charset=utf-8") {
  const body = type.startsWith("application/json") ? JSON.stringify(payload) : payload;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) { req.destroy(); reject(new Error("Payload trop volumineux")); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
async function api(req, res, url) {
  if (url.pathname === "/api/health") {
    return send(res, 200, { ok:true, version:VERSION, service:"jml-prospection-v2", time:new Date().toISOString() });
  }
  if (url.pathname === "/api/sources") {
    return send(res, 200, {
      version: VERSION,
      sources: [
        {id:"web-public",label:"Web public local",status:"available"},
        {id:"ban",label:"BAN / Géoplateforme",status:"available"},
        {id:"dvf",label:"DVF open data",status:"available"},
        {id:"dpe",label:"DPE open data",status:"available"}
      ]
    });
  }
  if (url.pathname === "/api/annonces") {
    return send(res, 200, await searchPublicListings(Object.fromEntries(url.searchParams.entries())));
  }
  if (url.pathname === "/api/marche") {
    return send(res, 200, await buildMarketSnapshot(Object.fromEntries(url.searchParams.entries())));
  }
  if (url.pathname === "/api/geocode" && req.method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return send(res,400,{error:"Paramètre q manquant"});
    return send(res,200,await geocodeAddress(q));
  }
  if (url.pathname === "/api/echo" && req.method === "POST") {
    const raw=await readBody(req); let data={}; try{data=raw?JSON.parse(raw):{};}catch{}
    return send(res,200,{ok:true,data});
  }
  return send(res,404,{error:"Route API inconnue",path:url.pathname});
}
function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==="/")pathname="/index.html";
  const file=path.normalize(path.join(PUBLIC,pathname));
  if(!file.startsWith(PUBLIC))return send(res,403,"Interdit","text/plain; charset=utf-8");
  fs.readFile(file,(err,data)=>{
    if(err)return send(res,404,"Fichier introuvable","text/plain; charset=utf-8");
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});res.end(data);
  });
}
const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,"http://localhost");if(url.pathname.startsWith("/api/"))return await api(req,res,url);return serveStatic(req,res,url);}
  catch(error){console.error(error);send(res,500,{error:"Erreur serveur",message:error.message});}
});
server.keepAliveTimeout=120000;
server.headersTimeout=125000;
server.listen(PORT,"0.0.0.0",()=>console.log("JML Prospection V2 listening on 0.0.0.0:"+PORT));
