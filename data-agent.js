/* JML Data Agent V1.10.1
   Contrôle qualité des données immobilières avant alimentation du radar.
   Le module ne profile pas de particuliers : il travaille sur des biens/données publiques.
*/
function finitePositive(v){ const n=Number(v); return Number.isFinite(n)&&n>0?n:0; }
function normText(v){ return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }
function qualityLevel(score){ return score>=85?"fiable":score>=65?"à vérifier":score>=40?"incertain":"rejeté"; }
function validateDpe(p){
  const issues=[], warnings=[]; let score=100;
  if(!p.address && !p.street){issues.push("Adresse absente");score-=45;}
  if(!p.cityCode && !p.city){warnings.push("Commune non identifiée");score-=10;}
  if(!p.area){warnings.push("Surface absente");score-=8;}
  if(p.area>1000){warnings.push("Surface inhabituelle à vérifier");score-=10;}
  if(p.energyConsumption<0 || p.gesValue<0){issues.push("Valeur énergétique négative");score-=35;}
  if(p.constructionYear && (p.constructionYear<1700 || p.constructionYear>new Date().getFullYear()+2)){issues.push("Année de construction incohérente");score-=30;}
  if(p.dpe && !/^[A-G]$/i.test(String(p.dpe).trim())){warnings.push("Classe DPE non standard");score-=15;}
  const level=qualityLevel(Math.max(0,score));
  return {score:Math.max(0,Math.round(score)),level,issues,warnings,accepted:level!=="rejeté"};
}
function validateDvf(t){
  const issues=[], warnings=[]; let score=100;
  if(!t.date){warnings.push("Date de mutation absente");score-=15;}
  if(!finitePositive(t.value)){issues.push("Valeur foncière absente ou nulle");score-=45;}
  if(t.builtArea<0 || t.landArea<0){issues.push("Surface négative");score-=35;}
  if(t.builtArea>0 && t.builtArea>10000){warnings.push("Surface bâtie inhabituelle");score-=15;}
  if(t.landArea>0 && t.landArea>100000){warnings.push("Terrain très important à vérifier");score-=10;}
  const level=qualityLevel(Math.max(0,score));
  return {score:Math.max(0,Math.round(score)),level,issues,warnings,accepted:level!=="rejeté"};
}
function duplicateKey(p){
  const address=normText(p.address||"");
  const cp=normText(p.postalCode||"");
  const city=normText(p.cityCode||p.city||"");
  const street=normText(p.street||"");
  return [city,cp,address||street].filter(Boolean).join("|");
}
function analyze({dpeRows=[],dvfRows=[]}={}){
  const dpeChecks=dpeRows.map(validateDpe), dvfChecks=dvfRows.map(validateDvf);
  const acceptedDpe=dpeRows.filter((_,i)=>dpeChecks[i].accepted);
  const acceptedDvf=dvfRows.filter((_,i)=>dvfChecks[i].accepted);
  const groups=new Map();
  for(const p of acceptedDpe){const k=duplicateKey(p);if(!k)continue;if(!groups.has(k))groups.set(k,[]);groups.get(k).push({source:"DPE ADEME",id:p.dpeNumber||"",area:p.area||0,areaKind:"habitable",surfaceLabel:"Surface habitable",dpe:p.dpe||"",address:p.address||""});}
  for(const t of acceptedDvf){const k=duplicateKey(t);if(!k)continue;if(!groups.has(k))groups.set(k,[]);groups.get(k).push({source:"DVF",id:t.mutationId||"",area:t.builtArea||0,areaKind:"built",surfaceLabel:"Surface bâtie",value:t.value||0,address:t.address||""});}
  const conflicts=[];
  for(const [key,items] of groups){const comparableGroups=new Map();
    for(const item of items){const kind=item.areaKind||"unknown";if(!comparableGroups.has(kind))comparableGroups.set(kind,[]);comparableGroups.get(kind).push(item)}
    for(const [kind,comparableItems] of comparableGroups){
      if(kind==="unknown")continue;
      const areas=comparableItems.map(x=>Number(x.area)||0).filter(Boolean);
      if(areas.length>=2){const min=Math.min(...areas),max=Math.max(...areas);if(min>0&&(max-min)/Math.max(min,max)>0.25)conflicts.push({key,reason:"Surfaces divergentes de plus de 25 % entre données de même nature",surfaceKind:kind,values:comparableItems});}
    }}
  const sourceStats={dpe:{received:dpeRows.length,accepted:acceptedDpe.length,rejected:dpeRows.length-acceptedDpe.length},dvf:{received:dvfRows.length,accepted:acceptedDvf.length,rejected:dvfRows.length-acceptedDvf.length}};
  const rejected=[...dpeChecks.map((c,i)=>({...c,index:i,source:"DPE ADEME"})).filter(x=>!x.accepted),...dvfChecks.map((c,i)=>({...c,index:i,source:"DVF"})).filter(x=>!x.accepted)];
  const warningCount=dpeChecks.concat(dvfChecks).reduce((n,c)=>n+c.warnings.length,0);
  const conflictCount=conflicts.length;
  const base=100-Math.min(70,rejected.length*8+conflictCount*5+warningCount*2);
  return {engine:"JML Data Agent",version:"1.10.1",qualityScore:Math.max(0,Math.round(base)),qualityLevel:qualityLevel(base),sourceStats,conflicts:conflicts.slice(0,50),rejected:rejected.slice(0,50),recommendations:["Les données rejetées ne doivent pas alimenter le radar.","Les conflits doivent rester visibles et être conservés dans l'historique.","Une information absente reste inconnue : aucune valeur ne doit être inventée.","Le score de qualité mesure la fiabilité des données récupérées, pas une probabilité de vente."]};
}
module.exports={analyze,validateDpe,validateDvf,qualityLevel};
