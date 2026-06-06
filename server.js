const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

// Détecte le bon exécutable Python (venv Railway ou système)
function getPython() {
  const candidates = [
    '/app/.venv/bin/python3',   // Railway venv
    '/app/.venv/bin/python',
    'python3',
    'python',
  ];
  for (const cmd of candidates) {
    try { execFileSync(cmd, ['--version'], { timeout: 3000 }); return cmd; } catch(e) {}
  }
  return 'python3';
}
const PYTHON = getPython();
console.log('🐍 Python:', PYTHON);

const app = express();
const PORT = process.env.PORT || 3000;

['uploads', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── BOT ──
let bot;
let botRetryTimer = null;

function startBot() {
  const settings = db.getSettings();
  if (!settings.botToken) return;
  try {
    if (bot) { try { bot.stopPolling(); } catch(e){} }
    // Délai de 3s au démarrage pour laisser l'ancienne instance Telegram expirer
    bot = new TelegramBot(settings.botToken, { polling: { autoStart: false, interval: 2000 } });

    // Gestion d'erreur polling — log sans crash
    bot.on('polling_error', (err) => {
      console.error('Polling error (ignoré):', err.message);
    });

    // Démarrage différé (laisse l'ancienne instance mourir)
    setTimeout(() => bot.startPolling(), 3000);

    bot.onText(/\/start/, (msg) => {
      const s = db.getSettings();
      const webUrl = s.webappUrl || `http://localhost:${PORT}`;
      // Enregistrer le membre
      db.upsertMember({ id: msg.from.id, name: (msg.from.first_name + ' ' + (msg.from.last_name || '')).trim(), username: msg.from.username || '', photo: null });
      bot.sendMessage(msg.chat.id,
        '👋 Bienvenue sur *FEUR BOXING* !\n\n🥊 La plateforme de référence pour vos commandes premium.',
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🛒 Ouvrir la boutique', web_app: { url: webUrl } }]] } }
      );
    });

    // Callbacks inline keyboard
    bot.on('callback_query', async (query) => {
      const data = query.data;
      if (data === 'done') { bot.answerCallbackQuery(query.id); return; }

      const actions = { 'payment_confirmed_': 'payment_confirmed', 'refuse_': 'refused', 'delivered_': 'delivered' };
      let action = null, orderId = null;
      for (const [prefix, status] of Object.entries(actions)) {
        if (data.startsWith(prefix)) { action = status; orderId = data.slice(prefix.length); break; }
      }
      if (!action) return;

      const order = db.getOrderById(orderId);
      if (!order) { bot.answerCallbackQuery(query.id, { text: '❌ Commande introuvable' }); return; }

      order.status = action;
      db.updateOrder(order);

      const labels = { payment_confirmed: '✅ PAIEMENT CONFIRMÉ', refused: '❌ REFUSÉE', delivered: '📦 COLIS DROP' };

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: labels[action] + ' (par admin)', callback_data: 'done' }]] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch(e) {}

      // Notifier le client
      const clientMsgs = {
        payment_confirmed: `✅ *Paiement confirmé !*\n\n📦 *${order.productName}*\n💰 €${order.price}\n\nVotre colis est en attente de scan. — FEUR BOXING`,
        refused: `❌ *Commande refusée.*\n\n📦 *${order.productName}*\n\nContactez le support : @feurman1`,
        delivered: `📦 *Colis drop !*\n\n📦 *${order.productName}*\n\nVotre colis a été déposé. Merci de votre confiance. — FEUR BOXING`
      };
      try { await bot.sendMessage(order.userId, clientMsgs[action], { parse_mode: 'Markdown' }); } catch(e) {}

      if (action === 'payment_confirmed') {
        await sendClientFileToAdmin(order);
      }

      bot.answerCallbackQuery(query.id, { text: labels[action] });
    });

    console.log('🤖 Bot démarré');
  } catch(e) { console.error('Bot error:', e.message); }
}

async function sendClientFileToAdmin(order) {
  const settings = db.getSettings();
  if (!bot || !settings.adminUid) return;
  const header = `📦 *Document client — Commande confirmée*\n🔑 \`${order.id}\`\n👤 ${order.userName}\n📦 ${order.productName}\n`;
  try {
    if (order.orderFile) {
      const fp = path.join(__dirname, 'uploads', order.orderFile);
      if (fs.existsSync(fp)) {
        const caption = header + (order.text ? `\n📋 Info: ${order.text}` : '');
        if (order.orderFile.match(/\.pdf$/i)) {
          await bot.sendDocument(settings.adminUid, fp, { caption, parse_mode: 'Markdown' });
        } else {
          await bot.sendPhoto(settings.adminUid, fp, { caption, parse_mode: 'Markdown' });
        }
      }
    } else if (order.text) {
      await bot.sendMessage(settings.adminUid, header + `\n📋 Info: ${order.text}`, { parse_mode: 'Markdown' });
    }
  } catch(e) { console.error('sendClientFile error:', e.message); }
}

startBot();

function adminAuth(req, res, next) {
  if (req.headers['x-admin'] === db.getSettings().adminToken) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── CATEGORIES ──
app.get('/api/categories', (req, res) => res.json(db.getCategories()));
app.post('/api/categories', adminAuth, (req, res) => { const c = { id: 'cat' + Date.now(), ...req.body }; db.addCategory(c); res.json(c); });
app.put('/api/categories/:id', adminAuth, (req, res) => { db.updateCategory({ id: req.params.id, ...req.body }); res.json({ ok: true }); });
app.delete('/api/categories/:id', adminAuth, (req, res) => { db.deleteCategory(req.params.id); res.json({ ok: true }); });

// ── PRODUCTS ──
app.get('/api/products', (req, res) => res.json(db.getProducts()));
app.post('/api/products', adminAuth, (req, res) => { const p = { id: 'p' + Date.now(), outOfStock: false, discount: 0, ...req.body }; db.addProduct(p); res.json(p); });
app.put('/api/products/:id', adminAuth, (req, res) => { db.updateProduct({ id: req.params.id, ...req.body }); res.json({ ok: true }); });
app.delete('/api/products/:id', adminAuth, (req, res) => { db.deleteProduct(req.params.id); res.json({ ok: true }); });

// ── ORDERS ──
app.get('/api/orders', (req, res) => {
  if (req.headers['x-admin'] === db.getSettings().adminToken) return res.json(db.getOrders());
  const uid = req.headers['x-user-id'];
  if (uid) return res.json(db.getOrders().filter(o => String(o.userId) === String(uid)));
  res.status(401).json({ error: 'Non autorisé' });
});

app.post('/api/orders', upload.fields([{ name: 'proof', maxCount: 1 }, { name: 'orderFile', maxCount: 1 }]), async (req, res) => {
  let data;
  try { data = JSON.parse(req.body.orderData); } catch(e) { return res.status(400).json({ error: 'Données invalides' }); }

  const orderId = 'FB-' + Date.now().toString(36).toUpperCase();
  const order = {
    id: orderId,
    userId: data.userId,
    userName: data.userName,
    username: data.username || '',
    photo: data.photo || null,
    productId: data.productId,
    productName: data.productName,
    catId: data.catId,
    catName: data.catName || '',
    price: data.price,
    text: data.text || '',
    payMethod: data.payMethod,
    customWeight: data.customWeight || false,
    weight: data.weight || '',
    status: 'pending',
    date: new Date().toISOString(),
    proofFile: req.files?.proof?.[0]?.filename || null,
    orderFile: req.files?.orderFile?.[0]?.filename || null,
    rating: null
  };

  db.addOrder(order);

  // Enregistrer le membre
  db.upsertMember({ id: data.userId, name: data.userName, username: data.username || '', photo: data.photo || null });

  // ─── 1 SEUL MESSAGE : photo de preuve + toutes les infos + boutons ───
  const settings = db.getSettings();
  if (bot && settings.adminUid) {
    const weightLine = order.customWeight && order.weight ? `\n⚖️ Poids : ${order.weight} kg (+5€)` : '';
    const caption = `🆕 *NOUVELLE COMMANDE — FEUR BOXING*\n\n📦 *${order.productName}* — ${order.desc||''}\n🗂 ${order.catName}\n💰 *€${order.price}*${weightLine}\n💳 ${(order.payMethod || '').toUpperCase()}\n\n👤 *${order.userName}*${order.username ? ' (@' + order.username + ')' : ''}\n🆔 \`${order.userId}\`\n📋 ${order.text || '_(fichier joint — envoyé à confirmation)_'}\n🗓 ${new Date().toLocaleString('fr-FR')}\n🔑 \`${orderId}\``;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Paiement confirmé', callback_data: 'payment_confirmed_' + orderId },
          { text: '❌ Refuser', callback_data: 'refuse_' + orderId }
        ],
        [
          { text: '📦 Colis drop', callback_data: 'delivered_' + orderId }
        ]
      ]
    };

    try {
      if (req.files?.proof?.[0]) {
        // Photo preuve avec caption contenant tout
        await bot.sendPhoto(settings.adminUid, req.files.proof[0].path, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await bot.sendMessage(settings.adminUid, caption, { parse_mode: 'Markdown', reply_markup: keyboard });
      }
      // Ne pas envoyer le fichier client ici — seulement à confirmation
    } catch(e) { console.error('TG error:', e.message); }
  }

  res.json({ ok: true, orderId });
});

app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  order.status = status;
  db.updateOrder(order);

  const clientMsgs = {
    payment_confirmed: `✅ *Paiement confirmé !*\n\n📦 *${order.productName}*\n\nVotre colis est en attente de scan. — FEUR BOXING`,
    refused: `❌ *Commande refusée.*\n\n📦 *${order.productName}*\n\nContactez le support : @feurman1`,
    delivered: `📦 *Colis drop !*\n\n📦 *${order.productName}*\n\nVotre colis a été déposé. Merci de votre confiance.`,
  };

  if (bot && order.userId && clientMsgs[status]) {
    try { await bot.sendMessage(order.userId, clientMsgs[status], { parse_mode: 'Markdown' }); } catch(e) {}
  }

  if (status === 'payment_confirmed') await sendClientFileToAdmin(order);

  res.json({ ok: true });
});

app.post('/api/orders/:id/rating', (req, res) => {
  db.addRating(req.params.id, req.body.rating);
  res.json({ ok: true });
});

// ── MEMBERS ──
app.put('/api/members/:id/points', adminAuth, (req, res) => {
  const { adjustment } = req.body; // positive or negative integer
  db.adjustMemberPoints(String(req.params.id), parseInt(adjustment) || 0);
  res.json({ ok: true, points: db.getMemberPoints(req.params.id) });
});

app.get('/api/members', adminAuth, (req, res) => {
  const members = db.getMembers();
  const orders = db.getOrders();
  const withStats = members.map(m => {
    const mOrders = orders.filter(o => String(o.userId) === String(m.id));
    const spent = mOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.price, 0);
    return { ...m, ordersCount: mOrders.length, totalSpent: spent, points: Math.floor(spent / 5) };
  });
  res.json(withStats);
});

app.get('/api/members/:id/points', (req, res) => {
  res.json({ points: db.getMemberPoints(req.params.id) });
});

// ── MESSAGES ──
app.post('/api/messages', adminAuth, async (req, res) => {
  const { userId, text } = req.body;
  if (!bot) return res.status(500).json({ error: 'Bot non disponible' });
  try {
    if (userId) {
      await bot.sendMessage(userId, `📢 *Message de FEUR BOXING*\n\n${text}`, { parse_mode: 'Markdown' });
      res.json({ ok: true, sent: 1 });
    } else {
      // Broadcast à tous les membres
      const members = db.getMembers();
      let sent = 0;
      for (const m of members) {
        try { await bot.sendMessage(m.id, `📢 *Message de FEUR BOXING*\n\n${text}`, { parse_mode: 'Markdown' }); sent++; } catch(e) {}
        await new Promise(r => setTimeout(r, 50)); // anti-rate-limit
      }
      res.json({ ok: true, sent });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PAYMENT SETTINGS (public) ──
app.get('/api/payment-settings', (req, res) => {
  const s = db.getSettings();
  res.json({ sol: s.sol, btc: s.btc, ltc: s.ltc, viro: s.viro, botUsername: s.botUsername || '' });
});

// ── SETTINGS ──
app.get('/api/settings', adminAuth, (req, res) => res.json(db.getSettings()));
app.put('/api/settings', adminAuth, (req, res) => {
  const allowed = ['adminUid', 'botToken', 'botUsername', 'webappUrl', 'adminPwd', 'sol', 'btc', 'ltc', 'viro'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  db.updateSettings(update);
  if (req.body.botToken) setTimeout(startBot, 500);
  res.json({ ok: true });
});

// ── STATS ──
app.get('/api/stats', adminAuth, (req, res) => {
  const orders = db.getOrders();
  const members = db.getMembers();
  const revenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.price, 0);
  const pending = orders.filter(o => o.status === 'pending').length;
  const confirmed = orders.filter(o => o.status === 'delivered').length;

  const ratings = orders.filter(o => o.rating).map(o => o.rating);
  const avgRating = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : null;

  const pSales = {};
  orders.forEach(o => {
    if (!pSales[o.productId]) pSales[o.productId] = { name: o.productName, catName: o.catName || '', sales: 0, revenue: 0 };
    pSales[o.productId].sales++;
    pSales[o.productId].revenue += o.price;
  });
  const topProducts = Object.values(pSales).sort((a, b) => b.sales - a.sales).slice(0, 8);

  // Revenus par jour (7 derniers jours)
  const revenueByDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const dayRev = orders
      .filter(o => o.status === 'delivered' && new Date(o.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) === key)
      .reduce((s, o) => s + o.price, 0);
    revenueByDay.push({ day: key, revenue: dayRev });
  }

  res.json({ total: orders.length, revenue, pending, confirmed, avgRating, topProducts, revenueByDay, membersCount: members.length });
});

// ── NEARBY COMPANIES ──
const NOM_HEADERS = { 'User-Agent': 'FeurBoxing/1.0', 'Accept-Language': 'fr' };

// Traduction des types OSM → français
const TYPE_FR = {
  estate_agent:'Agence immobilière', accountant:'Cabinet comptable', lawyer:"Cabinet d'avocat",
  notary:'Notaire', financial:'Finance', insurance:'Assurance', bank:'Banque',
  company:'Société', office:'Bureau', government:'Administration', ngo:'Association',
  it:'Informatique', architect:"Cabinet d'architecture", engineering:'Bureau d\'études',
  construction:'Construction', logistics:'Logistique', research:'Recherche',
  educational:'Éducation', healthcare:'Santé', administrative:'Administration',
  yes:'Société', industrial:'Zone industrielle', warehouse:'Entrepôt',
  commercial:'Commerce', retail:'Commerce', storage_tank:'Stockage',
};
function typeLabel(raw) {
  return TYPE_FR[raw?.toLowerCase()] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Société');
}

// Adresse complète avec numéro — essaie :
// 1. Reverse geocode Nominatim zoom=18 (bâtiment)
// 2. Si pas de numéro → cherche nœud addr:housenumber Overpass dans 150m
async function resolveAddress(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18`,
      { headers: NOM_HEADERS }
    );
    const d = await r.json();
    const a = d.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    if (a.house_number && a.road) {
      return `${a.house_number} ${a.road}${a.postcode ? ', ' + a.postcode : ''} ${city}`.trim();
    }
    // Pas de numéro → chercher un nœud adresse Overpass à proximité
    const q = `[out:json][timeout:8];node["addr:housenumber"]["addr:street"](around:150,${lat},${lon});out body 3;`;
    const ov = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: q,
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'FeurBoxing/1.0' }
    });
    const ovd = await ov.json();
    const n = ovd.elements?.[0]?.tags;
    if (n?.['addr:housenumber'] && n?.['addr:street']) {
      return `${n['addr:housenumber']} ${n['addr:street']}${n['addr:postcode'] ? ', ' + n['addr:postcode'] : ''} ${n['addr:city'] || city}`.trim();
    }
    // Fallback sans numéro
    if (a.road) return `${a.road}${a.postcode ? ', ' + a.postcode : ''} ${city}`.trim();
  } catch {}
  return null;
}

// Mapping type sélectionné → sous-requêtes Overpass
function buildTypeQuery(types, r, lat, lon) {
  const a = (r) => `around:${r},${lat},${lon}`;
  const parts = [];
  if (types.includes('bureau'))       parts.push(`node["name"]["office"](${a(r)});way["name"]["office"](${a(r)});relation["name"]["office"](${a(r)});`);
  if (types.includes('societe'))      parts.push(`node["name"]["company"](${a(r)});way["name"]["company"](${a(r)});`);
  if (types.includes('entrepot'))     parts.push(`way["name"]["building"~"^(warehouse|storage_tank)$"](${a(r)});node["name"]["industrial"](${a(r)});`);
  if (types.includes('industriel'))   parts.push(`way["name"]["landuse"~"^(industrial|commercial)$"](${a(r)});way["name"]["building"~"^(industrial|commercial)$"](${a(r)});`);
  if (types.includes('immo'))         parts.push(`node["name"]["office"="estate_agent"](${a(r)});way["name"]["office"="estate_agent"](${a(r)});`);
  if (types.includes('comptable'))    parts.push(`node["name"]["office"="accountant"](${a(r)});way["name"]["office"="accountant"](${a(r)});`);
  if (types.includes('avocat'))       parts.push(`node["name"]["office"="lawyer"](${a(r)});way["name"]["office"="lawyer"](${a(r)});`);
  if (types.includes('construction')) parts.push(`node["name"]["office"~"^(construction|architect|engineering)$"](${a(r)});way["name"]["office"~"^(construction|architect|engineering)$"](${a(r)});`);
  if (types.includes('sante'))        parts.push(`node["name"]["office"~"^(healthcare|physician|doctor)$"](${a(r)});node["name"]["amenity"~"^(clinic|hospital)$"](${a(r)});`);
  if (types.includes('education'))    parts.push(`node["name"]["office"="educational_institution"](${a(r)});node["name"]["amenity"~"^(school|college|university)$"](${a(r)});`);
  // Fallback si aucun type reconnu
  if (!parts.length) parts.push(`node["name"]["office"](${a(r)});node["name"]["company"](${a(r)});`);
  return parts.join('\n');
}

app.post('/api/test/nearby-companies', adminAuth, async (req, res) => {
  const { address, types } = req.body;
  const selectedTypes = Array.isArray(types) && types.length ? types : ['bureau','societe','entrepot','industriel'];
  if (!address) return res.status(400).json({ error: 'Adresse requise' });

  try {
    // 1. Géocodage
    const geoResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: NOM_HEADERS }
    );
    const geoData = await geoResp.json();
    if (!geoData.length) return res.status(404).json({ error: 'Adresse introuvable — soyez plus précis' });
    const { lat, lon, display_name } = geoData[0];

    // 2. Overpass — types sélectionnés, rayon progressif
    let candidates = [];
    for (const r of [500, 1000, 2000, 3000]) {
      const q = `[out:json][timeout:25];(\n${buildTypeQuery(selectedTypes, r, lat, lon)}\n);out body center 80;`;
      const ov = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: q,
        headers: { 'Content-Type': 'text/plain', 'User-Agent': 'FeurBoxing/1.0' }
      });
      const ovd = await ov.json();
      const seen = new Set();
      candidates = (ovd.elements || []).filter(e => {
        const n = e.tags?.name;
        if (!n || seen.has(n)) return false;
        seen.add(n); return true;
      });
      if (candidates.length >= 6) break;
    }

    // 3. Construire les 3 résultats avec adresse numérotée obligatoire
    const results = [];
    for (const e of candidates) {
      if (results.length >= 3) break;
      const t = e.tags || {};

      // Essayer adresse depuis les tags OSM d'abord
      let addr = null;
      if (t['addr:housenumber'] && t['addr:street']) {
        const city = t['addr:city'] || '';
        addr = `${t['addr:housenumber']} ${t['addr:street']}${t['addr:postcode'] ? ', ' + t['addr:postcode'] : ''} ${city}`.trim();
      }

      // Sinon, résolution complète (reverse geocode + Overpass addr node)
      if (!addr) {
        const elat = e.lat ?? e.center?.lat;
        const elon = e.lon ?? e.center?.lon;
        if (elat && elon) addr = await resolveAddress(elat, elon);
      }

      if (!addr) continue; // pas d'adresse du tout → on passe au suivant

      results.push({
        name:    t.name,
        address: addr,
        phone:   t.phone || t['contact:phone'] || t['contact:mobile'] || null,
        type:    typeLabel(t.office || t.company || t.industrial || t.building),
      });
    }

    res.json({ geocoded: display_name, lat, lon, results });
  } catch(e) {
    console.error('Nearby companies error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── TEST NOTIFY ──
app.post('/api/test/notify', adminAuth, async (req, res) => {
  const { text } = req.body;
  const settings = db.getSettings();
  if (!bot || !settings.adminUid) return res.status(500).json({ error: 'Bot ou adminUid non configuré' });
  try {
    await bot.sendMessage(settings.adminUid, `🧪 *[TEST ADMIN]*\n\n${text}`, { parse_mode: 'Markdown' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BORDEREAU ──
app.post('/api/bordereau/process', adminAuth, async (req, res) => {
  const { orderId, trackingNumber } = req.body;
  if (!trackingNumber) return res.status(400).json({ error: 'trackingNumber requis' });

  const settings = db.getSettings();
  const outFile  = path.join(__dirname, 'uploads', `bordereau-${Date.now()}.pdf`);
  const script   = path.join(__dirname, 'bordereau', 'process_bordereau.py');

  execFile(PYTHON, [script, trackingNumber, outFile], async (err, stdout, stderr) => {
    if (err) {
      const detail = (stderr || '').trim() || err.message || 'commande introuvable';
      console.error('Bordereau error:', { code: err.code, msg: err.message, stderr });
      return res.status(500).json({ error: 'Génération échouée : ' + detail });
    }

    const order = orderId ? db.getOrderById(orderId) : null;
    const caption = `📄 *Bordereau généré*\n\n🔑 \`${trackingNumber}\`${order
      ? `\n👤 ${order.userName}${order.username ? ' (@' + order.username + ')' : ''}\n📦 ${order.productName}\n🆔 \`${orderId}\``
      : ''}`;

    if (bot && settings.adminUid) {
      try {
        await bot.sendDocument(settings.adminUid, outFile, { caption, parse_mode: 'Markdown' });
      } catch (e) { console.error('TG bordereau error:', e.message); }
    }

    res.json({ ok: true });
  });
});

// ── ADMIN LOGIN ──
app.post('/api/admin/login', (req, res) => {
  const s = db.getSettings();
  if (req.body.password === s.adminPwd) res.json({ ok: true, token: s.adminToken });
  else res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 FEUR BOXING → http://localhost:${PORT}`);
  console.log(`🔐 Admin → http://localhost:${PORT}/#admin`);
  console.log(`🗝  MDP par défaut : admin2024\n`);
});

// Empêche le process de crasher sur erreur non gérée
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (ignoré):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection (ignoré):', reason?.message || reason);
});
