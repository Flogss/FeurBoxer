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
    { id: 'p-col-m1', catId: 'cat-colissimo', name: 'FTID',                        desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-col-m2', catId: 'cat-colissimo', name: 'Lit transit',                 desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-col-m3', catId: 'cat-colissimo', name: 'Reroute',                     desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-col-m4', catId: 'cat-colissimo', name: 'Reroute + livré',             desc: 'MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-col-m5', catId: 'cat-colissimo', name: 'Fix FTID / scan livré',       desc: 'MANUEL',  price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── CHRONOPOST ──
    { id: 'p-chr-m1', catId: 'cat-chronopost', name: 'FTID',                       desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-chr-m2', catId: 'cat-chronopost', name: 'Lit transit',                desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-chr-m3', catId: 'cat-chronopost', name: 'Reroute',                    desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-chr-m4', catId: 'cat-chronopost', name: 'Reroute + livré',            desc: 'MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-chr-m5', catId: 'cat-chronopost', name: 'Fix FTID / scan livré',      desc: 'MANUEL',  price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── DPD ──
    { id: 'p-dpd-m1', catId: 'cat-dpd', name: 'FTID',                              desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dpd-m2', catId: 'cat-dpd', name: 'Lit transit',                       desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dpd-m3', catId: 'cat-dpd', name: 'Reroute',                           desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dpd-m4', catId: 'cat-dpd', name: 'Reroute + livré',                   desc: 'MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dpd-m5', catId: 'cat-dpd', name: 'Fix FTID / scan livré',             desc: 'MANUEL',  price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── UPS ──
    { id: 'p-ups-m1', catId: 'cat-ups', name: 'Lit dépôt',                          desc: 'SCAN MANUEL',  price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-ups-m2', catId: 'cat-ups', name: 'Lit transit',                        desc: 'SCAN MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-ups-m3', catId: 'cat-ups', name: 'FTID',                               desc: 'SCAN MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── MONDIAL RELAY ──
    { id: 'p-mr-m1', catId: 'cat-mondialrelay', name: 'Lit scan',                   desc: 'SCAN MANUEL',  price: 30, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-mr-m2', catId: 'cat-mondialrelay', name: 'Lit transit',                desc: 'SCAN MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-mr-m3', catId: 'cat-mondialrelay', name: 'FTID',                       desc: 'SCAN MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-mr-m4', catId: 'cat-mondialrelay', name: 'FTID QR code',               desc: 'SCAN MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-mr-m5', catId: 'cat-mondialrelay', name: 'RTS',                        desc: 'SCAN MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-mr-m6', catId: 'cat-mondialrelay', name: 'Reroute',                    desc: 'SCAN MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── RELAIS COLIS ──
    { id: 'p-rc-m1', catId: 'cat-relaiscolis', name: 'FTID',                        desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-rc-m2', catId: 'cat-relaiscolis', name: 'Lit transit',                 desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-rc-m3', catId: 'cat-relaiscolis', name: 'Lit scan / dépôt',            desc: 'MANUEL',  price: 35, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-rc-m4', catId: 'cat-relaiscolis', name: 'Reroute',                     desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── DHL ──
    { id: 'p-dhl-m1', catId: 'cat-dhl', name: 'FTID',                               desc: 'MANUEL',  price: 60, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dhl-m2', catId: 'cat-dhl', name: 'Lit transit',                        desc: 'MANUEL',  price: 60, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-dhl-m3', catId: 'cat-dhl', name: 'Lit dépôt',                          desc: 'MANUEL',  price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── GLS ──
    { id: 'p-gls-m1', catId: 'cat-gls', name: 'FTID',                               desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-gls-m2', catId: 'cat-gls', name: 'Lit transit',                        desc: 'MANUEL',  price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── BPOST ──
    { id: 'p-bpost-1', catId: 'cat-bpost', name: 'Lit dépôt',                       desc: 'OFFRES', price: 40, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-bpost-2', catId: 'cat-bpost', name: 'Lit transit',                     desc: 'OFFRES', price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-bpost-3', catId: 'cat-bpost', name: 'FTID',                            desc: 'OFFRES', price: 50, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    // ── FEDEX ──
    { id: 'p-fedex-1', catId: 'cat-fedex', name: 'Lit transit',                     desc: 'OFFRES', price: 60, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true },
    { id: 'p-fedex-2', catId: 'cat-fedex', name: 'FTID',                            desc: 'OFFRES', price: 60, icon: '📦', inputType: 'text', inputHint: 'Entrez votre numéro de suivi', active: true, outOfStock: false, discount: 0, customWeight: true }
  ],
  orders: [],
  members: [],
  settings: {
    adminUid:    process.env.ADMIN_UID      || '',
    botToken:    process.env.BOT_TOKEN      || '',
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
  updateSettings: (s) => { const d = getDb(); d.settings = { ...d.settings, ...s }; persistDb(); }
};
