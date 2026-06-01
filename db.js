const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
  categories: [
    { id: 'cat-colissimo',    name: 'Colissimo',     icon: '', logoUrl: 'https://logo.clearbit.com/laposte.fr',       color: '#FFCD00', color2: '#003E80', desc: 'Livraison La Poste - Colissimo',     disabled: false },
    { id: 'cat-chronopost',   name: 'Chronopost',    icon: '', logoUrl: 'https://logo.clearbit.com/chronopost.fr',    color: '#F07800', color2: '#003189', desc: 'Express et international Chronopost', disabled: false },
    { id: 'cat-dpd',          name: 'DPD',           icon: '', logoUrl: 'https://logo.clearbit.com/dpd.fr',           color: '#DC0032', color2: '#414042', desc: 'Livraison DPD France',               disabled: false },
    { id: 'cat-ups',          name: 'UPS',           icon: '', logoUrl: 'https://logo.clearbit.com/ups.com',          color: '#351C15', color2: '#FFB500', desc: 'Livraison UPS',                       disabled: false },
    { id: 'cat-mondialrelay', name: 'Mondial Relay', icon: '', logoUrl: 'https://logo.clearbit.com/mondialrelay.fr',  color: '#E2001A', color2: '#1D1D1B', desc: 'Points relais Mondial Relay',         disabled: false },
    { id: 'cat-relaiscolis',  name: 'Relais Colis',  icon: '', logoUrl: 'https://logo.clearbit.com/relaiscolis.com', color: '#E4002B', color2: '#F7A800', desc: 'Réseau Relais Colis',                 disabled: false },
    { id: 'cat-dhl',          name: 'DHL',           icon: '', logoUrl: 'https://logo.clearbit.com/dhl.com',          color: '#D40511', color2: '#FFCC00', desc: 'Livraison DHL Express',               disabled: false },
    { id: 'cat-gls',          name: 'GLS',           icon: '', logoUrl: 'https://logo.clearbit.com/gls-group.eu',    color: '#009DE0', color2: '#F7A800', desc: 'Livraison GLS',                       disabled: false },
    { id: 'cat-fedex',        name: 'FedEx',         icon: '', logoUrl: 'https://logo.clearbit.com/fedex.com',        color: '#4D148C', color2: '#FF6600', desc: 'Livraison FedEx',                     disabled: false }
  ],
  products: [
    { id: 'p1', catId: 'cat-colissimo',    name: 'Suivi Colissimo',       price: 15,  icon: '📦', desc: 'Numéro de suivi Colissimo valide',              inputType: 'text', inputHint: 'Entrez votre numéro de commande',       active: true, outOfStock: false, discount: 0 },
    { id: 'p2', catId: 'cat-chronopost',   name: 'Suivi Chronopost',      price: 20,  icon: '📦', desc: 'Numéro de suivi Chronopost Express',            inputType: 'text', inputHint: 'Entrez votre numéro de commande',       active: true, outOfStock: false, discount: 0 },
    { id: 'p3', catId: 'cat-dpd',          name: 'Suivi DPD',             price: 12,  icon: '📦', desc: 'Numéro de suivi DPD France',                    inputType: 'text', inputHint: 'Entrez votre numéro de commande',       active: true, outOfStock: false, discount: 0 },
    { id: 'p4', catId: 'cat-ups',          name: 'Suivi UPS',             price: 18,  icon: '📦', desc: 'Numéro de suivi UPS',                           inputType: 'text', inputHint: 'Entrez votre numéro de commande',       active: true, outOfStock: false, discount: 0 },
    { id: 'p5', catId: 'cat-mondialrelay', name: 'Suivi Mondial Relay',   price: 10,  icon: '📦', desc: 'Numéro de suivi Mondial Relay',                 inputType: 'text', inputHint: 'Entrez votre numéro de commande',       active: true, outOfStock: false, discount: 0 },
    { id: 'p6', catId: 'cat-dhl',          name: 'Suivi DHL',             price: 22,  icon: '📦', desc: 'Numéro de suivi DHL Express international',     inputType: 'file', inputHint: 'Uploadez votre bon de commande',         active: true, outOfStock: false, discount: 0 },
    { id: 'p7', catId: 'cat-fedex',        name: 'Suivi FedEx',           price: 25,  icon: '📦', desc: 'Numéro de suivi FedEx international',           inputType: 'both', inputHint: 'Numéro + photo du colis si disponible', active: true, outOfStock: false, discount: 0 }
  ],
  orders: [],
  members: [],
  settings: {
    adminUid: '5220151803',
    botToken: '8835439612:AAGio5SpIsS7w1NyN30b96RCn8OPgQLJO0o',
    botUsername: '',
    webappUrl: 'http://localhost:3000',
    adminPwd: 'admin2024',
    adminToken: uuidv4(),
    sol: 'GfkQLH7mVQr3ZWdmBZFqNKJhEu5HpDxFYv3AXP9nWSQC',
    btc: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    ltc: 'LaBFN7mGdLXhB9Vwx8FtEGBs5NJPqa2DdK',
    viro: 'PayPal : paypal.me/feurboxing\n\nVirement IBAN : FR76 3000 4000 0300 0001 0000 000\nBIC : BNPAFRPPXXX\nRéférence : votre ID de commande'
  }
};

function ensureDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  const d = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!d.members) d.members = [];
  return d;
}

function write(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  // Categories
  getCategories: () => read().categories,
  addCategory: (cat) => { const d = read(); d.categories.push(cat); write(d); },
  updateCategory: (cat) => { const d = read(); d.categories = d.categories.map(c => c.id === cat.id ? cat : c); write(d); },
  deleteCategory: (id) => { const d = read(); d.categories = d.categories.filter(c => c.id !== id); write(d); },

  // Products
  getProducts: () => read().products,
  addProduct: (p) => { const d = read(); d.products.push(p); write(d); },
  updateProduct: (p) => { const d = read(); d.products = d.products.map(x => x.id === p.id ? p : x); write(d); },
  deleteProduct: (id) => { const d = read(); d.products = d.products.filter(p => p.id !== id); write(d); },

  // Orders
  getOrders: () => read().orders,
  getOrderById: (id) => read().orders.find(o => o.id === id),
  addOrder: (order) => { const d = read(); d.orders.unshift(order); write(d); },
  updateOrder: (order) => { const d = read(); d.orders = d.orders.map(o => o.id === order.id ? order : o); write(d); },
  addRating: (orderId, rating) => {
    const d = read();
    const o = d.orders.find(x => x.id === orderId);
    if (o) { o.rating = rating; write(d); }
  },

  // Members
  getMembers: () => read().members,
  getMemberById: (id) => read().members.find(m => String(m.id) === String(id)),
  upsertMember: (member) => {
    const d = read();
    if (!d.members) d.members = [];
    const idx = d.members.findIndex(m => String(m.id) === String(member.id));
    if (idx >= 0) {
      d.members[idx] = { ...d.members[idx], ...member, lastSeen: new Date().toISOString() };
    } else {
      d.members.push({ ...member, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
    }
    write(d);
  },
  getMemberPoints: (userId) => {
    const d = read();
    const orders = d.orders;
    const total = orders
      .filter(o => String(o.userId) === String(userId) && o.status === 'confirmed')
      .reduce((s, o) => s + (o.price || 0), 0);
    const base = Math.floor(total / 5);
    const member = d.members.find(m => String(m.id) === String(userId));
    return base + (member?.bonusPoints || 0);
  },
  adjustMemberPoints: (userId, amount) => {
    const d = read();
    const m = d.members.find(x => String(x.id) === String(userId));
    if (m) { m.bonusPoints = (m.bonusPoints || 0) + amount; write(d); }
  },

  // Settings
  getSettings: () => read().settings,
  updateSettings: (s) => { const d = read(); d.settings = { ...d.settings, ...s }; write(d); }
};
