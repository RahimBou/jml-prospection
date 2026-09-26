const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "market-memory.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function save(memory) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(memory, null, 2));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function key(item) {
  if (item.external_url) return "url:" + normalize(item.external_url);
  return "data:" + [
    normalize(item.source),
    normalize(item.title),
    normalize(item.city),
    normalize(item.address),
    Number(item.surface) || 0
  ].join("|");
}

function snapshot(items, options = {}) {
  const memory = load();
  const now = new Date().toISOString();
  const currentKeys = new Set();
  const priceChanges = [];
  const newItems = [];

  for (const item of items || []) {
    const k = key(item);
    currentKeys.add(k);
    const previous = memory[k];

    if (!previous) {
      memory[k] = {
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1,
        initialPrice: Number(item.price) || 0,
        currentPrice: Number(item.price) || 0,
        title: item.title || "",
        address: item.address || "",
        city: item.city || "",
        surface: Number(item.surface) || 0,
        source: item.source || "",
        external_url: item.external_url || "",
        status: "active"
      };
      newItems.push(item);
      continue;
    }

    const oldPrice = Number(previous.currentPrice) || 0;
    const newPrice = Number(item.price) || 0;

    if (oldPrice > 0 && newPrice > 0 && oldPrice !== newPrice) {
      priceChanges.push({
        ...item,
        previous_price: oldPrice,
        current_price: newPrice,
        change: newPrice - oldPrice,
        change_percent: Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10
      });
    }

    previous.lastSeenAt = now;
    previous.seenCount = Number(previous.seenCount || 0) + 1;
    previous.currentPrice = newPrice || oldPrice;
    previous.title = item.title || previous.title;
    previous.address = item.address || previous.address;
    previous.status = "active";
    delete previous.disappearedAt;
  }

  const disappeared = [];
  const safeToDetectDisappearance = Boolean(options.sourceReady) && (items || []).length > 0;

  if (safeToDetectDisappearance) {
    for (const [k, previous] of Object.entries(memory)) {
      if (!currentKeys.has(k) && previous.status === "active") {
        previous.status = "disappeared";
        previous.disappearedAt = now;
        disappeared.push({ ...previous });
      }
    }
  }

  save(memory);
  return {
    newItems,
    priceChanges,
    disappeared,
    memorySize: Object.keys(memory).length
  };
}

module.exports = { snapshot, load };
