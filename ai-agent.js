/* JML IA Agent V1.0.0
   Couche IA optionnelle pour le CRM JML Prospection.
   - Fonctionne sans clé avec une analyse locale déterministe.
   - Peut utiliser Gemini côté serveur si GEMINI_API_KEY est configurée dans Render.
   - N'utilise que les données du bien/CRM fournies par l'utilisateur.
   - Ne déduit jamais une intention de vendre à partir du DPE, DVF ou d'une donnée privée.
*/
const MAX_TEXT=12000;
function clean(v,max=500){return String(v??"").replace(/\s+/g," ").trim().slice(0,max)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function compactProspect(p={}){
  return {
    address:clean(p.address),postalCode:clean(p.postalCode,20),city:clean(p.city,100),district:clean(p.district,100),
    type:clean(p.type,60),area:num(p.area),land:num(p.land),rooms:num(p.rooms),bedrooms:num(p.bedrooms),price:num(p.price),
    dpe:clean(p.dpe,10),status:clean(p.status,80),detectionDate:clean(p.detectionDate,30),nextFollow:clean(p.nextFollow,30),
    source:clean(p.source,150),description:clean(p.description,1500),notes:clean(p.notes,2500),
    dataQuality:p.dataQuality?{score:num(p.dataQuality.score),level:clean(p.dataQuality.level,50),label:clean(p.dataQuality.label,100)}:null,
    commercialSignalScore:num(p.commercialSignalScore),futureRadarScore:num(p.futureRadarScore),
    priorityProspectionScore:num(p.priorityProspectionScore),priorityProspectionLevel:clean(p.priorityProspectionLevel,100),
    movementScore:num(p.movement6mScore||p.movementScore),
    priceHistory:Array.isArray(p.priceHistory)?p.priceHistory.slice(-8).map(x=>({date:clean(x.date,30),price:num(x.price),reason:clean(x.reason,100)})):[],
    appearanceHistory:Array.isArray(p.appearanceHistory)?p.appearanceHistory.slice(-8).map(x=>({date:clean(x.date,30),source:clean(x.source,120)})):[],
    history:Array.isArray(p.history)?p.history.slice(-8).map(x=>({date:clean(x.date,30),type:clean(x.type,80),text:clean(x.text,600)})):[]
  }
}
function localAnalysis(p,task,context=""){
  const reasons=[],actions=[],objections=[],questions=[],warnings=[];
  const priceM2=p.price>0&&p.area>0?Math.round(p.price/p.area):0;
  if(p.address&&p.city)reasons.push("Localisation renseignée et exploitable pour préparer le secteur.");
  else warnings.push("Adresse ou commune incomplète : compléter avant une analyse terrain.");
  if(p.area>0)reasons.push(`Surface renseignée : ${p.area} m²${p.land>0?` · terrain ${p.land} m²`:""}.`);
  if(p.price>0&&priceM2>0)reasons.push(`Prix renseigné : ${p.price.toLocaleString("fr-FR")} € · environ ${priceM2.toLocaleString("fr-FR")} €/m².`);
  if(p.dpe)reasons.push(`DPE renseigné : ${p.dpe}.`);
  if(p.source)reasons.push(`Source de la fiche : ${p.source}.`);
  if(p.commercialSignalScore>0)reasons.push(`Signal commercial public déjà documenté : ${p.commercialSignalScore}/100.`);
  if(p.priorityProspectionScore>0)reasons.push(`Priorité de prospection enregistrée : ${Math.round(p.priorityProspectionScore)}/100.`);
  if(p.priceHistory.length>=2)reasons.push("Un historique de prix est disponible : vérifier l'évolution avant l'appel.");
  if(p.appearanceHistory.length>=2)reasons.push("Plusieurs apparitions dans les sources sont enregistrées.");
  if(p.history.length)reasons.push("Un historique de contact existe : reprendre le dernier échange plutôt que repartir de zéro.");
  const status=p.status.toLowerCase();
  if(status.includes("relanc"))actions.push("Relire le dernier historique et préparer une relance courte, factuelle et personnalisée.");
  else if(status.includes("visit")||status.includes("nouveau"))actions.push("Préparer 3 questions de qualification avant tout argumentaire.");
  else actions.push("Commencer par qualifier le projet et le calendrier, puis seulement parler d'estimation ou de mandat.");
  questions.push("Quel est aujourd'hui votre projet concernant ce bien ?");
  questions.push("Si vous deviez faire évoluer votre situation, à quel horizon cela pourrait-il être ?");
  questions.push("Qu'est-ce qui serait le plus important pour vous dans une éventuelle vente ?");
  objections.push({objection:"Je ne veux pas vendre",response:"Je comprends. Mon objectif est simplement de comprendre votre situation et de vous laisser une information utile sur le marché, sans engagement."});
  objections.push({objection:"Je veux vendre moi-même",response:"Bien sûr. Je peux simplement vous apporter un regard local sur le prix, les comparables et les points à anticiper, puis vous restez libre de votre méthode."});
  objections.push({objection:"Je trouve votre estimation trop basse",response:"Le plus utile est de reprendre les comparables qui justifient la fourchette et de distinguer prix affiché, prix signé et caractéristiques réellement comparables."});
  objections.push({objection:"Je vais attendre",response:"D'accord. Quel élément vous ferait considérer que le moment est devenu intéressant ? Cela permet surtout de savoir quand reprendre contact."});
  if(task==="call")actions.unshift("Appel : rester sur 30–60 secondes au départ, obtenir l'autorisation de poursuivre puis poser une question ouverte.");
  else if(task==="report")actions.unshift("Compte-rendu : enregistrer uniquement les faits observés, les propos du prospect, le statut et la prochaine action.");
  else if(task==="followup")actions.unshift("Relance : reprendre le dernier élément connu et proposer une prochaine étape simple.");
  return {
    mode:"local",
    title:task==="call"?"Préparation d'appel":task==="report"?"Compte-rendu de visite":task==="followup"?"Relance":"Analyse du prospect",
    summary:`Fiche ${p.type||"bien"}${p.city?` · ${p.city}`:""}${p.area?` · ${p.area} m²`:""}. L'analyse reste descriptive et s'appuie uniquement sur les informations enregistrées.`,
    reasons:reasons.slice(0,8),actions:actions.slice(0,6),questions:questions.slice(0,5),objections:objections.slice(0,4),
    warnings:warnings.slice(0,6),context:clean(context,2000),
    disclaimer:"L'assistant ne déduit pas une intention de vendre à partir de données DPE/DVF ou d'informations privées. Vérifier les faits avant toute utilisation commerciale."
  }
}
function buildPrompt(p,task,context){
  const taskLabel={analyze:"analyser la fiche et expliquer les éléments utiles à la prospection",why:"expliquer pourquoi ce prospect remonte dans le travail à partir des signaux déjà documentés",call:"préparer un appel de prospection naturel et court",report:"transformer le compte-rendu fourni en synthèse CRM factuelle avec prochaine action",followup:"préparer une relance personnalisée et non agressive"}[task]||"analyser la fiche";
  return `Tu es l'assistant commercial de JML Immobilier dans les Ardennes. Tu dois ${taskLabel}. Réponds en français, de manière courte, concrète et professionnelle. N'invente aucune donnée. N'infère jamais qu'un propriétaire veut vendre à partir d'un DPE, d'une transaction DVF, d'un âge de bien, d'une consommation énergétique ou d'une donnée privée. Utilise uniquement les informations fournies. Distingue les faits des hypothèses. Ne fournis pas de coordonnées personnelles ni de méthode pour identifier un particulier.\n\nFICHE BIEN/CRM:\n${JSON.stringify(p,null,2)}\n\nCONTEXTE UTILISATEUR:\n${clean(context,3000)}\n\nPrésente : 1) synthèse, 2) faits utiles, 3) questions à poser, 4) prochaine action, 5) objections possibles et réponses. Pour un appel ou une relance, donne aussi un texte prêt à dire, maximum 120 mots.`
}
async function callGemini(prompt){
  const key=String(process.env.GEMINI_API_KEY||"").trim();
  if(!key)return null;
  const model=String(process.env.GEMINI_MODEL||"gemini-3.6-flash").trim();
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
      body:JSON.stringify({systemInstruction:{parts:[{text:"Tu es l'assistant IA de JML Immobilier. Reste factuel, professionnel, respectueux de la vie privée et du cadre de prospection. Ne déduis jamais une intention de vente à partir de données immobilières publiques seules."}]},
      contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.35,maxOutputTokens:900}}),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data?.error?.message||`Gemini HTTP ${response.status}`);
    const text=data?.candidates?.[0]?.content?.parts?.map(x=>x?.text||"").join("\n").trim();
    if(!text)throw new Error("Gemini n'a renvoyé aucun texte");
    return {text,model};
  }finally{clearTimeout(timer)}
}
function rankProspects(prospects=[]){
  return prospects.map((p,i)=>({prospect:compactProspect(p),score:Number(p.priorityProspectionScore)||Number(p.commercialSignalScore)||0,signal:Number(p.commercialSignalScore)||0,quality:Number(p.dataQuality?.score)||0,index:i})).sort((a,b)=>b.score-a.score||b.signal-a.signal||b.quality-a.quality).slice(0,10);
}
async function runAi({task="analyze",prospect={},context="",prospects=[]}={}){
  if(task==="priority") return {ok:true,provider:"local",task,ranked:rankProspects(prospects),generatedAt:new Date().toISOString(),disclaimer:"Classement de travail fondé sur les scores déjà calculés. Il ne constitue pas une probabilité de vente et n'infère pas l'intention d'un propriétaire."};
  const p=compactProspect(prospect),local=localAnalysis(p,task,context),prompt=buildPrompt(p,task,context);
  try{const remote=await callGemini(prompt);if(remote)return{ok:true,provider:"Gemini",model:remote.model,task,local,text:remote.text,generatedAt:new Date().toISOString()}}
  catch(error){return{ok:true,provider:"local-fallback",task,local,warning:`IA distante indisponible : ${error.message}`,generatedAt:new Date().toISOString()}}
  return{ok:true,provider:"local",task,local,generatedAt:new Date().toISOString()}
}
module.exports={runAi,compactProspect,localAnalysis};
