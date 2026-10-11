"use strict";

/**
 * JML Prospection — Leboncoin source adapter.
 *
 * Leboncoin's public CGU prohibit automated extraction without express prior
 * authorization. This adapter does NOT crawl HTML, browse search pages, log in,
 * or evade rate limits/CAPTCHAs. It accepts only an explicitly authorized
 * partner/API/feed URL configured by the operator.
 *
 * Enable only after authorization has been obtained:
 * LEBONCOIN_SOURCE_AUTHORIZED=true
 * LEBONCOIN_FEED_URL=<authorized HTTPS feed/API endpoint>
 *
 * The feed must return JSON. Keep existing DVF/DPE/CRM code independent.
 */

const SOURCE = "Leboncoin (flux autorisé)";

function clean(value, max = 1000) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const normalized = String(value).replace(/[\u00a0\s]/g, "").replace(/[€]/g, "").replace(/,/g, ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function normalizeListing(raw, collectedAt = new Date().toISOString()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = clean(firstDefined(raw.url, raw.external_url, raw.permalink, raw.web_url), 2000);
  if (!url || !/^https:\/\/(?:www\.)?leboncoin\.fr\//i.test(url)) return null;

  const title = clean(firstDefined(raw.title, raw.subject, raw.name), 300);
  const description = clean(firstDefined(raw.description, raw.body, raw.text), 5000);
  const price = numberOrNull(firstDefined(raw.price, raw.price_eur, raw.amount));
  const surface = numberOrNull(firstDefined(raw.surface, raw.area, raw.living_area, raw.square_meters));
  const terrain = numberOrNull(firstDefined(raw.land_area, raw.terrain, raw.land_surface));
  const rooms = numberOrNull(firstDefined(raw.rooms, raw.number_of_rooms, raw.nb_rooms));
  const location = raw.location && typeof raw.location === "object" ? raw.location : {};
  const seller = raw.seller && typeof raw.seller === "object" ? raw.seller : {};

  const transaction = clean(firstDefined(raw.transaction_type, raw.transaction, raw.offer_type), 50).toLowerCase();
  const category = clean(firstDefined(raw.category, raw.property_type, raw.real_estate_type), 100);
  const text = (title + " " + description + " " + category + " " + transaction).toLowerCase();
  if (/\b(location|louer|loyer|rent)\b/.test(text) && !/\b(vente|vendre|achat)\b/.test(text)) return null;
  if (price == null || price <= 0) return null;
  if (!/(immobilier|maison|appartement|terrain|immeuble|vente|real estate|house|flat|apartment|land)/i.test(text)) return null;

  const id = clean(firstDefined(raw.id, raw.listing_id, raw.reference, raw.ad_id), 200);
  const city = clean(firstDefined(raw.city, raw.commune, location.city, location.name), 150);
  const postalCode = clean(firstDefined(raw.postal_code, raw.postcode, raw.zip_code, location.postal_code), 10);
  const address = clean(firstDefined(raw.address, location.address), 250);
  const publishedAt = clean(firstDefined(raw.published_at, raw.created_at, raw.first_publication_date), 80);
  const updatedAt = clean(firstDefined(raw.updated_at, raw.modified_at, raw.last_update_date), 80);
  const sellerType = clean(firstDefined(raw.seller_type, seller.type, seller.kind), 80);

  return {
    source: SOURCE,
    source_id: id || null,
    source_url: url,
    title: title || null,
    description: description || null,
    transaction_type: "sale",
    property_type: clean(firstDefined(raw.property_type, raw.real_estate_type, category), 100) || null,
    price_eur: price,
    surface_m2: surface,
    land_surface_m2: terrain,
    rooms: rooms == null ? null : Math.round(rooms),
    price_per_m2: surface && surface > 0 ? Math.round((price / surface) * 100) / 100 : null,
    city: city || null,
    postal_code: postalCode || null,
    address: address || null,
    latitude: numberOrNull(firstDefined(raw.latitude, location.latitude)),
    longitude: numberOrNull(firstDefined(raw.longitude, location.longitude)),
    dpe: clean(firstDefined(raw.dpe, raw.energy_class, raw.energy_efficiency), 20) || null,
    seller_type: sellerType || null,
    published_at: publishedAt || null,
    source_updated_at: updatedAt || null,
    collected_at: collectedAt,
    provenance: { source: SOURCE, source_url: url, collected_at: collectedAt, method: "authorized_json_feed", price_is_asking_price: true }
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "results", "ads", "listings", "data"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizeFeed(payload, collectedAt) {
  const timestamp = collectedAt || new Date().toISOString();
  const seen = new Set();
  const items = [];
  for (const row of extractRows(payload)) {
    const item = normalizeListing(row, timestamp);
    if (!item) continue;
    const key = item.source_id || item.source_url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return {
    source: SOURCE, method: "authorized_json_feed", collected_at: timestamp,
    count: items.length, items,
    note: "Les prix sont des prix affichés, pas des prix de vente signés."
  };
}

async function fetchAuthorizedFeed(options = {}) {
  const env = options.env || process.env;
  if (String(env.LEBONCOIN_SOURCE_AUTHORIZED || "").toLowerCase() !== "true") {
    return { ok: false, status: "authorization_required", source: SOURCE, count: 0, items: [],
      message: "Collecte désactivée : obtenir une autorisation expresse de Leboncoin et configurer le flux/API autorisé." };
  }

  const feedUrl = clean(env.LEBONCOIN_FEED_URL, 2000);
  let parsed;
  try { parsed = new URL(feedUrl); }
  catch {
    return { ok: false, status: "configuration_error", source: SOURCE, count: 0, items: [],
      message: "LEBONCOIN_FEED_URL doit être une URL HTTPS autorisée." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, status: "configuration_error", source: SOURCE, count: 0, items: [],
      message: "Seuls les flux HTTPS sont acceptés." };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, status: "runtime_error", source: SOURCE, count: 0, items: [],
      message: "fetch indisponible dans ce runtime Node.js." };
  }
  const timeoutMs = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed.toString(), {
      method: "GET", headers: { Accept: "application/json" }, signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, status: "upstream_error", http_status: response.status, source: SOURCE, count: 0, items: [],
        message: "Le flux autorisé a répondu HTTP " + response.status + "." };
    }
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("json")) {
      return { ok: false, status: "invalid_content_type", source: SOURCE, count: 0, items: [],
        message: "Le flux autorisé doit retourner du JSON." };
    }
    return { ok: true, status: "ok", ...normalizeFeed(await response.json()) };
  } catch (error) {
    const timeout = error?.name === "AbortError";
    return { ok: false, status: timeout ? "timeout" : "network_error", source: SOURCE, count: 0, items: [],
      message: timeout ? "Délai dépassé pour le flux autorisé." : "Flux autorisé inaccessible : " + clean(error?.message || "erreur réseau", 250) };
  } finally { clearTimeout(timer); }
}

module.exports = { normalizeListing, normalizeFeed, fetchAuthorizedFeed };
