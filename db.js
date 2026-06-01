const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
  categories: [
    { id: 'cat1', name: 'Gants & Équipements', icon: '🥊', desc: 'Gants de boxe, protège-dents, bandages premium', color: 'blue' },
    { id: 'cat2', name: 'Coaching Privé', icon: '🏋️', desc: 'Sessions 1-on-1 avec nos coachs certifiés', color: 'violet' },
    { id: 'cat3', name: 'Documents Officiels', icon: '📋', desc: 'Licences, certifications, accréditations sportives', color: 'pink' },
    { id: 'cat4', name: 'Nutrition & Compléments', icon: '💊', desc: 'Suppléments pro, packs nutrition sur mesure', color: 'blue' },
    { id: 'cat5', name: 'Merchandising', icon: '👕', desc: 'Vêtements et accessoires FEUR BOXING exclusifs', color: 'violet' },
    { id: 'cat6', name: 'Formations', icon: '🎓', desc: "Accès aux cours vidéo et programmes d'entraînement", color: 'pink' }
  ],
  products: [
    { id: 'p1', catId: 'cat1', name: 'Gants Pro 12oz', price: 85, icon: '🥊', desc: 'Gants professionnels cuir véritable, idéaux compétition', inputType: 'text', inputHint: 'Entrez votre tour de main en cm', active: true, outOfStock: false, discount: 0 },
    { id: 'p2', catId: 'cat1', name: 'Bandages Mexicains', price: 25, icon: '🩹', desc: 'Bandages élastiques 4.5m, protection maximale', inputType: 'text', inputHint: 'Taille : S/M/L/XL', active: true, outOfStock: false, discount: 0 },
    { id: 'p3', catId: 'cat2', name: 'Session Coaching x5', price: 200, icon: '🏋️', desc: "5 sessions d'1h avec un coach certifié FBF", inputType: 'both', inputHint: 'Indiquez votre niveau et disponibilités', active: true, outOfStock: false, discount: 0 },
    { id: 'p4', catId: 'cat3', name: 'Licence Fédérale', price: 120, icon: '📋', desc: 'Obtention ou renouvellement de votre licence officielle', inputType: 'file', inputHint: "Uploadez une photo de votre pièce d'identité", active: true, outOfStock: false, discount: 0 },
    { id: 'p5', catId: 'cat4', name: 'Pack Protéines 3 mois', price: 150, icon: '💊', desc: 'Whey + créatine + BCAA formule exclusive', inputType: 'text', inputHint: 'Entrez votre poids et objectif', active: true, outOfStock: false, discount: 0 },
    { id: 'p6', catId: 'cat5', name: 'T-shirt FEUR BOXING', price: 45, icon: '👕', desc: 'T-shirt technique coton/polyester, logo brodé', inputType: 'text', inputHint: 'Taille et couleur', active: true, outOfStock: false, discount: 0 },
    { id: 'p7', catId: 'cat6', name: 'Formation Boxe Thaï', price: 99, icon: '🎓', desc: '12h de contenu vidéo, débutant à avancé', inputType: 'text', inputHint: 'Votre email pour accès à la plateforme', active: true, outOfStock: false, discount: 0 }
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
