"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeListing, normalizeFeed, fetchAuthorizedFeed } = require("../leboncoin-source.js");

const valid = {
  id: "listing-123",
  url: "https://www.leboncoin.fr/ad/ventes_immobilieres/123456",
  title: "Maison 5 pièces à vendre",
  description: "Maison avec jardin",
  category: "Immobilier",
  transaction_type: "sale",
  price: "189 000 €",
  surface: "105",
  land_area: 420,
  rooms: 5,
  city: "Charleville-Mézières",
  postal_code: "08000",
  dpe: "D",
  seller_type: "particulier"
};

test("normalizes an authorized-feed listing and preserves provenance", () => {
  const item = normalizeListing(valid, "2026-10-11T06:00:00.000Z");
  assert.ok(item);
  assert.equal(item.price_eur, 189000);
  assert.equal(item.surface_m2, 105);
  assert.equal(item.price_per_m2, 1800);
  assert.equal(item.rooms, 5);
  assert.equal(item.seller_type, "particulier");
  assert.equal(item.provenance.price_is_asking_price, true);
  assert.equal(item.collected_at, "2026-10-11T06:00:00.000Z");
});

test("rejects URLs outside the Leboncoin listing domain", () => {
  assert.equal(normalizeListing({ ...valid, url: "https://example.com/listing/1" }), null);
});

test("rejects rentals and rows without an asking price", () => {
  assert.equal(normalizeListing({ ...valid, title: "Appartement en location", transaction_type: "rent" }), null);
  assert.equal(normalizeListing({ ...valid, price: null }), null);
});

test("deduplicates records by source ID", () => {
  const result = normalizeFeed({ items: [valid, { ...valid, title: "Titre modifié" }] }, "2026-10-11T06:00:00.000Z");
  assert.equal(result.count, 1);
  assert.equal(result.items[0].title, "Maison 5 pièces à vendre");
});

test("does not fetch until express authorization is configured", async () => {
  let called = false;
  const result = await fetchAuthorizedFeed({
    env: { LEBONCOIN_SOURCE_AUTHORIZED: "false", LEBONCOIN_FEED_URL: "https://authorized.example/feed" },
    fetchImpl: async () => { called = true; throw new Error("should not be called"); }
  });
  assert.equal(result.status, "authorization_required");
  assert.equal(called, false);
});

test("requires HTTPS for configured authorized feed", async () => {
  const result = await fetchAuthorizedFeed({
    env: { LEBONCOIN_SOURCE_AUTHORIZED: "true", LEBONCOIN_FEED_URL: "http://authorized.example/feed" },
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, "configuration_error");
});

test("fetches and normalizes JSON only after authorization is enabled", async () => {
  let calledUrl = "";
  const result = await fetchAuthorizedFeed({
    env: { LEBONCOIN_SOURCE_AUTHORIZED: "true", LEBONCOIN_FEED_URL: "https://authorized.example/feed" },
    fetchImpl: async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ results: [valid] }) };
    }
  });
  assert.equal(calledUrl, "https://authorized.example/feed");
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].source_id, "listing-123");
});
