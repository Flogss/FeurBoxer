require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

// Détecte le bon exécutable Python — vérifie l'existence avant d'exécuter
function getPython() {
  for (const cmd of ['/app/.venv/bin/python3', '/app/.venv/bin/python']) {
    if (fs.existsSync(cmd)) return cmd;
  }
  for (const cmd of ['python3', 'python']) {
    try { execFileSync(cmd, ['--version'], { timeout: 1000 }); return cmd; } catch(e) {}
  }
  return 'python3';
}
const PYTHON = getPython();
console.log('🐍 Python:', PYTHON);

// Force le catalogue produits au démarrage (écrase les anciens produits dans db.json)
db.syncProducts();

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
  if (order.fileSent) return;
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
    order.fileSent = true;
    db.updateOrder(order);
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

  // Validate product and price server-side
  const product = db.getProducts().find(p => p.id === data.productId);
  if (!product || !product.active || product.outOfStock) {
    return res.status(400).json({ error: 'Produit invalide ou indisponible' });
  }
  const basePrice = product.discount > 0
    ? Math.round(product.price * (1 - product.discount / 100))
    : product.price;
  const weightExtra = data.customWeight ? 5 : 0;
  const expectedPrice = basePrice + weightExtra;
  if (Math.abs(parseFloat(data.price) - expectedPrice) > 0.01) {
    return res.status(400).json({ error: 'Prix invalide' });
  }
  data.price = expectedPrice;

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
const NOM_UA = { 'User-Agent': 'FeurBoxing/1.0' };

const TYPE_FR = {
  estate_agent:'Agence immobilière', accountant:'Cabinet comptable', lawyer:"Cabinet d'avocat",
  notary:'Notaire', financial:'Finance', insurance:'Assurance', bank:'Banque',
  company:'Société', office:'Bureau', government:'Administration', ngo:'Association',
  it:'Informatique', architect:"Cabinet d'architecture", engineering:"Bureau d'études",
  construction:'Construction', logistics:'Logistique', research:'Recherche',
  educational:'Éducation', healthcare:'Santé', administrative:'Administration',
  yes:'Société', industrial:'Zone industrielle', warehouse:'Entrepôt',
  commercial:'Commerce', retail:'Commerce', storage_tank:'Stockage',
};
// Secteur d'activité d'après la section NAF (API recherche-entreprises)
const SECTION_NAF = {
  A:'Agriculture', B:'Industrie extractive', C:'Industrie', D:'Énergie', E:'Eau / Déchets',
  F:'Construction', G:'Commerce', H:'Transport / Logistique', I:'Hôtellerie / Restauration',
  J:'Information / Communication', K:'Finance / Assurance', L:'Immobilier',
  M:'Services aux entreprises', N:'Services administratifs', O:'Administration',
  P:'Éducation', Q:'Santé / Social', R:'Arts / Loisirs', S:'Autres services',
  T:'Services domestiques', U:'Organisme extraterritorial',
};
function typeLabel(raw) {
  if (!raw) return 'Société';
  return TYPE_FR[raw.toLowerCase()] || (raw.charAt(0).toUpperCase() + raw.slice(1));
}


async function safeJson(resp) {
  const txt = await resp.text();
  if (txt.trim().startsWith('<')) throw new Error('Réponse API invalide (HTML reçu au lieu de JSON)');
  return JSON.parse(txt);
}

function buildAddr(num, street, postcode, city) {
  // "17 Rue des Coquelicots, 94150 Rungis"
  const parts = [num, street].filter(Boolean).join(' ');
  const zone  = [postcode, city].filter(Boolean).join(' ');
  return [parts, zone].filter(Boolean).join(', ') || null;
}

// Extrait le code postal français (5 chiffres) d'une chaîne
function extractCP(str) { const m = str.match(/\b(\d{5})\b/); return m ? m[1] : null; }

// Géocodage via api-adresse.data.gouv.fr (gouvernement FR, fiable depuis Railway)
async function geocodeFR(address) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;
    const txt = await resp.text();
    if (txt.trim().startsWith('<')) return null;
    const data = JSON.parse(txt);
    const feat = data.features?.[0];
    if (!feat) return null;
    return { postcode: feat.properties.postcode, city: feat.properties.city };
  } catch { return null; }
}

app.post('/api/test/nearby-companies', adminAuth, async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Adresse requise' });

  try {
    // 1. Extraire le code postal — depuis l'adresse saisie ou via api-adresse.gouv.fr
    let cp   = extractCP(address);
    let city = '';

    if (!cp) {
      const geo = await geocodeFR(address);
      if (geo) { cp = geo.postcode; city = geo.city; }
    }

    if (!cp) {
      return res.status(404).json({
        error: 'Code postal introuvable — incluez-le dans l\'adresse (ex: 95820)'
      });
    }

    // 2. API SIRENE officielle — registre national des entreprises
    const sireResp = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?code_postal=${cp}&per_page=25&page=1`,
      { headers: { 'User-Agent': 'FeurBoxing/1.0' }, signal: AbortSignal.timeout(9000) }
    );
    if (!sireResp.ok) throw new Error(`SIRENE HTTP ${sireResp.status}`);
    const sireTxt = await sireResp.text();
    if (sireTxt.trim().startsWith('<')) throw new Error('SIRENE a retourné du HTML');
    const sireData = JSON.parse(sireTxt);

    // Nature juridique à exclure (auto-entrepreneurs, EI, EIRL)
    const EXCLUDE_NJ = new Set(['1000','1100','1200','1300','1400','1500','5499']);

    const results = (sireData.results || [])
      .map(co => {
        const nj = String(co.nature_juridique || '');
        if (EXCLUDE_NJ.has(nj) || !co.nom_complet) return null;
        // Établissement réellement situé dans le code postal recherché (pas le siège, souvent ailleurs)
        const etab = (co.matching_etablissements || []).find(e => e.adresse) || co.matching_etablissements?.[0];
        if (!etab || !etab.adresse) return null;
        return {
          name:    co.nom_complet,
          address: etab.adresse,
          type:    SECTION_NAF[co.section_activite_principale] || 'Société',
        };
      })
      .filter(Boolean)
      .slice(0, 20);

    const commune = sireData.results?.[0]?.matching_etablissements?.[0]?.libelle_commune || city;
    res.json({ geocoded: `${cp} ${commune}`, results });

  } catch(e) {
    const cause = e.cause?.message || e.cause || '';
    console.error('Nearby companies error:', e.message, cause ? '| cause: ' + cause : '');
    res.status(500).json({ error: 'Erreur : ' + e.message + (cause ? ' (' + cause + ')' : '') });
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
  const { orderId, trackingNumber, sender } = req.body;
  if (!trackingNumber) return res.status(400).json({ error: 'trackingNumber requis' });

  const settings = db.getSettings();
  const outFile  = path.join(__dirname, 'uploads', `bordereau-${Date.now()}.pdf`);
  const script   = path.join(__dirname, 'bordereau', 'process_bordereau.py');

  // Expéditeur / point relais optionnel — transmis en JSON au script Python
  const args = [script, trackingNumber, outFile];
  if (sender && typeof sender === 'object') {
    const allowed = ['relais', 'enseigne', 'name', 'street', 'city'];
    const clean = {};
    allowed.forEach(k => { if (typeof sender[k] === 'string' && sender[k].trim()) clean[k] = sender[k].trim().slice(0, 60); });
    if (Object.keys(clean).length) args.push(JSON.stringify(clean));
  }

  execFile(PYTHON, args, async (err, stdout, stderr) => {
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

// ── BORDEREAU : ANALYSE D'UN PDF UPLOADÉ (extraction des infos) ──
app.post('/api/bordereau/extract', adminAuth, upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  const pdfPath = req.file.path;
  const script  = path.join(__dirname, 'bordereau', 'extract_bordereau.py');
  const cleanup = () => { try { fs.unlinkSync(pdfPath); } catch (e) {} };

  execFile(PYTHON, [script, pdfPath], { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
    cleanup();
    if (err) {
      console.error('Extract error:', { code: err.code, msg: err.message, stderr });
      return res.status(500).json({ error: 'Analyse échouée : ' + ((stderr || '').trim() || err.message) });
    }
    try {
      const data = JSON.parse(stdout);
      if (data.error) return res.status(422).json(data);
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: 'Réponse illisible du script' });
    }
  });
});

// ── BORDEREAU : MODIFICATION D'UN PDF + ENVOI À L'ADMIN ──
app.post('/api/bordereau/modify', adminAuth, upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF requis' });
  const inPath  = req.file.path;
  const outPath = path.join(__dirname, 'uploads', `bordereau-mod-${Date.now()}.pdf`);
  const script  = path.join(__dirname, 'bordereau', 'modify_bordereau.py');
  const cleanup = () => { try { fs.unlinkSync(inPath); } catch (e) {} };

  let edits;
  try { edits = JSON.parse(req.body.edits || '{}'); } catch (e) { cleanup(); return res.status(400).json({ error: 'edits invalide' }); }
  // Validation/limites
  edits.text = Array.isArray(edits.text) ? edits.text.slice(0, 20).filter(t => t && t.old && t.new) : [];
  edits.barcodes = Array.isArray(edits.barcodes) ? edits.barcodes.slice(0, 6).filter(b => b && b.old && b.new) : [];
  edits.page = parseInt(edits.page) || 0;

  execFile(PYTHON, [script, inPath, outPath, JSON.stringify(edits)],
    { maxBuffer: 5 * 1024 * 1024, timeout: 40000 }, async (err, stdout, stderr) => {
    cleanup();
    if (err) {
      console.error('Modify error:', { code: err.code, msg: err.message, stderr });
      return res.status(500).json({ error: 'Modification échouée : ' + ((stderr || '').trim() || err.message) });
    }
    const settings = db.getSettings();
    if (bot && settings.adminUid) {
      const label = req.body.label ? `\n📦 ${req.body.label}` : '';
      try {
        await bot.sendDocument(settings.adminUid, outPath, {
          caption: `✏️ *Bordereau modifié*${label}`, parse_mode: 'Markdown'
        });
      } catch (e) { console.error('TG modify error:', e.message); }
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

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err.stack || err.message);
  if (!['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason?.stack || reason?.message || reason);
});
