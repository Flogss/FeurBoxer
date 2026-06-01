const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

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
    bot = new TelegramBot(settings.botToken, { polling: true });

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
    const caption = `🆕 *NOUVELLE COMMANDE — FEUR BOXING*\n\n📦 *${order.productName}*\n🗂 ${order.catName}\n💰 *€${order.price}*\n💳 ${(order.payMethod || '').toUpperCase()}\n\n👤 *${order.userName}*${order.username ? ' (@' + order.username + ')' : ''}\n🆔 \`${order.userId}\`\n📋 ${order.text || '_(fichier joint — envoyé à confirmation)_'}\n🗓 ${new Date().toLocaleString('fr-FR')}\n🔑 \`${orderId}\``;

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
  res.json({ sol: s.sol, btc: s.btc, ltc: s.ltc, viro: s.viro });
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
  const pending = orders.filter(o => o.status === 'paid').length;
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
