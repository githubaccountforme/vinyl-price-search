// ============================================================
//  db.js — JSON file-based watchlist storage
//  No native modules required — works anywhere Node.js runs.
// ============================================================

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// Store in /data (can be a Render persistent disk) or local for dev
const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'watchlist.json');

// ── I/O ───────────────────────────────────────────────────────

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE))  return [];
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(records) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
}

function randomToken() {
  return crypto.randomBytes(20).toString('hex');
}

// ── Public API ────────────────────────────────────────────────

// Add a watch entry
function addWatch({ email, query, itemTitle, alertBelow, lastPrice }) {
  const records = load();
  const id      = Date.now();
  const token   = randomToken();
  records.push({
    id,
    email,
    query,
    item_title:   itemTitle,
    alert_below:  alertBelow  || null,
    last_price:   lastPrice   || null,
    token,
    created_at:   new Date().toISOString(),
    last_checked: null,
    last_alerted: null,
  });
  save(records);
  return { id, token };
}

// Get all entries that haven't been checked in the last 20 hours
function getDueWatches() {
  const records  = load();
  const cutoff   = new Date(Date.now() - 20 * 60 * 60 * 1000);
  return records.filter(r => {
    if (!r.last_checked) return true;
    return new Date(r.last_checked) < cutoff;
  });
}

// Update last_price + last_checked after a price check
function updateChecked(id, lastPrice) {
  const records = load();
  const rec     = records.find(r => r.id === id);
  if (rec) {
    rec.last_price   = lastPrice;
    rec.last_checked = new Date().toISOString();
    save(records);
  }
}

// Mark as alerted
function markAlerted(id) {
  const records = load();
  const rec     = records.find(r => r.id === id);
  if (rec) {
    rec.last_alerted = new Date().toISOString();
    save(records);
  }
}

// Delete by token (unsubscribe link)
function removeByToken(token) {
  const records  = load();
  const filtered = records.filter(r => r.token !== token);
  const removed  = filtered.length < records.length;
  if (removed) save(filtered);
  return removed;
}

// Get all watches for an email
function getWatchesByEmail(email) {
  return load().filter(r => r.email === email);
}

module.exports = { addWatch, getDueWatches, updateChecked, markAlerted, removeByToken, getWatchesByEmail };
