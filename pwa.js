(()=>{try{
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
  let installEvent=null;
  window.addEventListener("beforeinstallprompt",e=>{
    e.preventDefault(); installEvent=e;
    const top=document.querySelector(".top-actions");
    if(!top||document.getElementById("installJmlBtn")) return;
    const b=document.createElement("button");
    b.id="installJmlBtn"; b.className="primary"; b.textContent="📲 Installer";
    b.addEventListener("click",async()=>{
      if(!installEvent)return;
      installEvent.prompt(); await installEvent.userChoice; installEvent=null; b.remove();
    });
    top.prepend(b);
  });
})();