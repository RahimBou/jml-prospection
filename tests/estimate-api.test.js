"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEstimateInput, isAuthorized, createRateLimiter } = require("../engine/estimate-api");

test("validates required type, surface and location", () => {
  assert.equal(validateEstimateInput({ type: "Maison", surface: 100, latitude: 49.77, longitude: 4.72 }).ok, true);
  assert.equal(validateEstimateInput({ type: "Terrain", surface: 100, latitude: 49.77, longitude: 4.72 }).ok, false);
  assert.equal(validateEstimateInput({ type: "Maison", surface: 100 }).ok, false);
  assert.equal(validateEstimateInput({ type: "Maison", surface: 100, latitude: 40, longitude: 2 }).ok, false);
});
test("refuses missing, malformed or wrong bearer token", () => {
  assert.equal(isAuthorized("", "secret-token"), false);
  assert.equal(isAuthorized("secret-token", "secret-token"), false);
  assert.equal(isAuthorized("Bearer wrong", "secret-token"), false);
  assert.equal(isAuthorized("Bearer secret-token", "secret-token"), true);
  assert.equal(isAuthorized("Bearer secret-token", ""), false);
});
test("rate limiter enforces per-key window and resets", () => {
  let now = 1000;
  const allow = createRateLimiter({ limit: 2, windowMs: 100, now: () => now });
  assert.equal(allow("ip1"), true);
  assert.equal(allow("ip1"), true);
  assert.equal(allow("ip1"), false);
  assert.equal(allow("ip2"), true);
  now += 101;
  assert.equal(allow("ip1"), true);
});