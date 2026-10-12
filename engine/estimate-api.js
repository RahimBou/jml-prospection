"use strict";
const crypto = require("node:crypto");

function validateEstimateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Objet JSON requis" };
  const type = String(body.type || "");
  if (!["Maison", "Appartement"].includes(type)) return { ok: false, error: "type doit être Maison ou Appartement" };
  const surface = Number(body.surface);
  if (!Number.isFinite(surface) || surface < 9 || surface > 1000) return { ok: false, error: "surface doit être comprise entre 9 et 1000 m²" };
  const terrain = body.terrain === undefined || body.terrain === null || body.terrain === "" ? null : Number(body.terrain);
  if (terrain !== null && (!Number.isFinite(terrain) || terrain < 0 || terrain > 100000)) return { ok: false, error: "terrain invalide" };
  const rooms = body.rooms === undefined || body.rooms === null || body.rooms === "" ? null : Number(body.rooms);
  if (rooms !== null && (!Number.isInteger(rooms) || rooms < 1 || rooms > 30)) return { ok: false, error: "rooms doit être un entier entre 1 et 30" };
  const latitude = body.latitude === undefined || body.latitude === null || body.latitude === "" ? null : Number(body.latitude);
  const longitude = body.longitude === undefined || body.longitude === null || body.longitude === "" ? null : Number(body.longitude);
  if ((latitude === null) !== (longitude === null)) return { ok: false, error: "latitude et longitude doivent être fournies ensemble" };
  if (latitude !== null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 49 || latitude > 50.3 || longitude < 3.8 || longitude > 5.8)) return { ok: false, error: "coordonnées hors zone attendue des Ardennes" };
  const commune = String(body.commune || "").trim();
  if (commune.length > 100) return { ok: false, error: "commune trop longue" };
  if (latitude === null && !commune) return { ok: false, error: "coordonnées ou commune requises" };
  return { ok: true, value: { type, surface, terrain, rooms, latitude, longitude, commune, dateReference: body.dateReference } };
}
function isAuthorized(header, token) {
  if (!token || typeof token !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function createRateLimiter({ limit = 20, windowMs = 60_000, now = Date.now } = {}) {
  const buckets = new Map();
  return function allow(key = "unknown") {
    const current = now();
    const bucket = buckets.get(key);
    if (!bucket || current - bucket.start >= windowMs) {
      buckets.set(key, { start: current, count: 1 });
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (current - v.start >= windowMs) buckets.delete(k);
      }
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  };
}
module.exports = { validateEstimateInput, isAuthorized, createRateLimiter };