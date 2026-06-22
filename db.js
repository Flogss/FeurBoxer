require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
  categories: [
    { id: 'cat-colissimo',    name: 'Colissimo',     icon: '', logoUrl: '/logo/colissimo1.png',    color: '#FFCD00', color2: '#003E80', desc: 'Livraison La Poste - Colissimo',     disabled: false },
    { id: 'cat-chronopost',   name: 'Chronopost',    icon: '', logoUrl: '/logo/chronopost1.png',   color: '#F07800', color2: '#003189', desc: 'Express et international Chronopost', disabled: false },
    { id: 'cat-dpd',          name: 'DPD',           icon: '', logoUrl: '/logo/dpd1.png',          color: '#DC0032', color2: '#414042', desc: 'Livraison DPD France',               disabled: false },
    { id: 'cat-ups',          name: 'UPS',           icon: '', logoUrl: '/logo/ups1.png',          color: '#351C15', color2: '#FFB500', desc: 'Livraison UPS',                       disabled: false },
    { id: 'cat-mondialrelay', name: 'Mondial Relay', icon: '', logoUrl: '/logo/mondialr1.png',     color: '#E2001A', color2: '#1D1D1B', desc: 'Points relais Mondial Relay',         disabled: false },
    { id: 'cat-relaiscolis',  name: 'Relais Colis',  icon: '', logoUrl: '/logo/relaicolis1.png',   color: '#E4002B', color2: '#F7A800', desc: 'Réseau Relais Colis',                 disabled: false },
    { id: 'cat-dhl',          name: 'DHL',           icon: '', logoUrl: '/logo/dhl1.png',          color: '#D40511', color2: '#FFCC00', desc: 'Livraison DHL Express',               disabled: false },
    { id: 'cat-gls',          name: 'GLS',           icon: '', logoUrl: '/logo/gls1.png',          color: '#009DE0', color2: '#F7A800', desc: 'Livraison GLS',                       disabled: false },
    { id: 'cat-fedex',        name: 'FedEx',         icon: '', logoUrl: '/logo/fedex1.png',        color: '#4D148C', color2: '#FF6600', desc: 'Livraison FedEx',                     disabled: false },
    { id: 'cat-bpost',        name: 'Bpost',          icon: '⚪', logoUrl: '',                    color: '#E20020', color2: '#FFD700', desc: 'Livraison Bpost Belgique',            disabled: false }
  ],
  products: [
    // ── COLISSIMO ──
    { id: 'p-col-m1',    catId: 'cat-colissimo',    name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-col-m2',    catId: 'cat-colissimo',    name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-col-m3',    catId: 'cat-colissimo',    name: 'Reroute',      desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-col-rts',   catId: 'cat-colissimo',    name: 'RTS',          desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    // ── CHRONOPOST ──
    { id: 'p-chr-m1',    catId: 'cat-chronopost',   name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-chr-m2',    catId: 'cat-chronopost',   name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    // ── DPD ──
    { id: 'p-dpd-m1',   catId: 'cat-dpd',          name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-dpd-m2',   catId: 'cat-dpd',          name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-dpd-secure',catId: 'cat-dpd',          name: 'FTID Secure',  desc: 'Manuel', price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    // ── UPS ──
    { id: 'p-ups-m2',   catId: 'cat-ups',          name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-ups-m3',   catId: 'cat-ups',          name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    // ── MONDIAL RELAY ──
    { id: 'p-mr-m3',    catId: 'cat-mondialrelay', name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-mr-m4',    catId: 'cat-mondialrelay', name: 'FTID QR code', desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-mr-m2',    catId: 'cat-mondialrelay', name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    // ── RELAIS COLIS ──
    { id: 'p-rc-m1',    catId: 'cat-relaiscolis',  name: 'FTID',         desc: 'Manuel', price: 20, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
    { id: 'p-rc-m2',    catId: 'cat-relaiscolis',  name: 'Lit transit',  desc: 'Manuel', price: 25, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: false },
  ],
  orders: [],
  members: [],
  settings: {
    adminUid:      process.env.ADMIN_UID        || '',
    botToken:      process.env.BOT_TOKEN        || '',
    dropBotToken:  process.env.DROP_BOT_TOKEN   || '',
    botUsername: '',
    webappUrl:   process.env.WEBAPP_URL     || 'http://localhost:3000',
    adminPwd:    process.env.ADMIN_PASSWORD || 'admin2024',
    adminToken:  uuidv4(),
    sol:         process.env.SOL            || '',
    btc:         process.env.BTC            || '',
    ltc:         process.env.LTC            || '',
    viro:        process.env.VIRO           || '',
  }
};

// ── In-memory DB (single source of truth) ──
let _db = null;

function ensureDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getDb() {
  if (_db) return _db;
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    _db = JSON.parse(JSON.stringify(DEFAULT_DB));
    persistDb();
    return _db;
  }
  try {
    _db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('DB read error, using defaults:', e.message);
    _db = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  if (!_db.members) _db.members = [];
  if (!_db.dropEntries) _db.dropEntries = [];
  if (!_db.settings.dropBotToken) _db.settings.dropBotToken = process.env.DROP_BOT_TOKEN || '';
  if (_db.settings.dropPriceDefault === undefined) _db.settings.dropPriceDefault = 5;
  if (!_db.settings.dropPrices) _db.settings.dropPrices = {};
  if (!_db.settings.dropNotifyUid) _db.settings.dropNotifyUid = '';
  if (!_db.settings.dropManualRevenue) _db.settings.dropManualRevenue = 0;
  if (!_db.settings.dropPrefixes) _db.settings.dropPrefixes = {};
  _db.dropEntries.forEach(e => { if (e.paid === undefined) e.paid = false; });
  return _db;
}

function persistDb() {
  try {
    ensureDir();
    fs.writeFileSync(DB_PATH, JSON.stringify(_db, null, 2));
  } catch (e) {
    console.error('DB write error:', e.message);
  }
}

module.exports = {
  // Categories
  getCategories: () => getDb().categories,
  addCategory:   (cat) => { getDb().categories.push(cat); persistDb(); },
  updateCategory: (cat) => { const d = getDb(); d.categories = d.categories.map(c => c.id === cat.id ? cat : c); persistDb(); },
  deleteCategory: (id)  => { const d = getDb(); d.categories = d.categories.filter(c => c.id !== id); persistDb(); },

  // Products
  getProducts:   () => getDb().products,
  addProduct:    (p)  => { getDb().products.push(p); persistDb(); },
  updateProduct: (p)  => { const d = getDb(); d.products = d.products.map(x => x.id === p.id ? p : x); persistDb(); },
  deleteProduct: (id) => { const d = getDb(); d.products = d.products.filter(p => p.id !== id); persistDb(); },

  // Orders
  getOrders:    () => getDb().orders,
  getOrderById: (id) => getDb().orders.find(o => o.id === id),
  addOrder:     (order) => { getDb().orders.unshift(order); persistDb(); },
  updateOrder:  (order) => { const d = getDb(); d.orders = d.orders.map(o => o.id === order.id ? order : o); persistDb(); },
  addRating:    (orderId, rating) => {
    const d = getDb();
    const o = d.orders.find(x => x.id === orderId);
    if (o) { o.rating = rating; persistDb(); }
  },

  // Members
  getMembers:   () => getDb().members,
  getMemberById: (id) => getDb().members.find(m => String(m.id) === String(id)),
  upsertMember: (member) => {
    const d = getDb();
    const idx = d.members.findIndex(m => String(m.id) === String(member.id));
    if (idx >= 0) {
      d.members[idx] = { ...d.members[idx], ...member, lastSeen: new Date().toISOString() };
    } else {
      d.members.push({ ...member, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
    }
    persistDb();
  },
  getMemberPoints: (userId) => {
    const d = getDb();
    const total = d.orders
      .filter(o => String(o.userId) === String(userId) && o.status === 'delivered')
      .reduce((s, o) => s + (o.price || 0), 0);
    const base = Math.floor(total / 5);
    const member = d.members.find(m => String(m.id) === String(userId));
    return base + (member?.bonusPoints || 0);
  },
  adjustMemberPoints: (userId, amount) => {
    const d = getDb();
    const m = d.members.find(x => String(x.id) === String(userId));
    if (m) { m.bonusPoints = (m.bonusPoints || 0) + amount; persistDb(); }
  },

  // Settings
  getSettings:    () => getDb().settings,
  updateSettings: (s) => { const d = getDb(); d.settings = { ...d.settings, ...s }; persistDb(); },

  // Drop entries
  getDropEntries: () => getDb().dropEntries,
  getDropEntryById: (id) => getDb().dropEntries.find(e => e.id === id),
  addDropEntry: (entry) => { getDb().dropEntries.unshift(entry); persistDb(); },
  updateDropEntry: (entry) => { const d = getDb(); d.dropEntries = d.dropEntries.map(e => e.id === entry.id ? entry : e); persistDb(); },
  deleteDropEntry: (id) => { const d = getDb(); d.dropEntries = d.dropEntries.filter(e => e.id !== id); persistDb(); },

  // Force-sync products to DEFAULT_DB catalog (called on server startup)
  syncProducts: () => {
    const d = getDb();
    d.products = JSON.parse(JSON.stringify(DEFAULT_DB.products));
    persistDb();
    console.log('📦 Catalogue produits synchronisé (' + d.products.length + ' produits)');
  }
};
