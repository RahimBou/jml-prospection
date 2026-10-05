const APP_VERSION = "1.50.0";
/* V1.50 — le frontend Render web doit toujours viser le service API dédié. */
const API_BASE = String(window.JML_API_BASE || ((location.hostname === "jml-prospection-web.onrender.com" || location.hostname === "jml-prospection.onrender.com") ? "https://jml-prospection-web.onrender.com" : "")).replace(/\/$/,"");