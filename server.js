const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── DOSSIERS ──
['uploads', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── MULTER (uploads fichiers) ──
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── BOT TELEGRAM ──
let bot;
function startBot() {
  const settings = db.getSettings();
  if (!settings.botToken) return;
  try {
    if (bot) { try { bot.stopPolling(); } catch(e){} }
    bot = new TelegramBot(settings.botToken, { polling: true });

    // /start → bouton pour ouvrir le WebApp
    bot.onText(/\/start/, (msg) => {
      const settings = db.getSettings();
      const webUrl = settings.webappUrl || `http://localhost:${PORT}`;
      bot.sendMessage(msg.chat.id,
        '👋 Bienvenue sur *FEUR BOXING* !\n\n🥊 La plateforme de référence pour vos commandes premium.\nService discret, rapide et sécurisé.',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🛒 Ouvrir la boutique', web_app: { url: webUrl } }
            ]]
          }
        }
      );
    });

    // Callbacks des boutons Confirmer / Refuser
    bot.on('callback_query', async (query) => {
      const data = query.data;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;

      if (!data.startsWith('confirm_') && !data.startsWith('refuse_') && !data.startsWith('processing_')) return;

      let action, orderId;
      if (data.startsWith('confirm_')) { action = 'confirmed'; orderId = data.slice(8); }
      else if (data.startsWith('refuse_')) { action = 'refused'; orderId = data.slice(7); }
      else if (data.startsWith('processing_')) { action = 'processing'; orderId = data.slice(11); }

      const order = db.getOrderById(orderId);
      if (!order) {
        bot.answerCallbackQuery(query.id, { text: '❌ Commande introuvable' });
        return;
      }

      order.status = action;
      db.updateOrder(order);

      const statusEmoji = { confirmed: '✅', refused: '❌', processing: '🔄' };
      const statusLabel = { confirmed: 'CONFIRMÉE', refused: 'REFUSÉE', processing: 'EN TRAITEMENT' };

      // Modifier le message admin pour enlever les boutons et indiquer l'action
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: `${statusEmoji[action]} ${statusLabel[action]} par l'admin`, callback_data: 'done' }]] },
          { chat_id: chatId, message_id: msgId }
        );
      } catch(e) {}

      // Notifier le client
      const clientMsgs = {
        confirmed: `✅ *Votre commande a été confirmée !*\n\n📦 *${order.productName}*\n💰 €${order.price}\n\nNous traitons votre demande. Merci de votre confiance. — FEUR BOXING`,
        refused: `❌ *Votre commande a été refusée.*\n\n📦 *${order.productName}*\n\nContactez notre support pour plus d'informations : @feurman1`,
        processing: `🔄 *Votre commande est en cours de traitement.*\n\n📦 *${order.productName}*\n\nNous vous tenons informé dès que c'est prêt.`
      };

      try {
        await bot.sendMessage(order.userId, clientMsgs[action], { parse_mode: 'Markdown' });
      } catch(e) {
        console.log('Impossible de notifier le client:', e.message);
      }

      bot.answerCallbackQuery(query.id, { text: `${statusEmoji[action]} Commande ${statusLabel[action].toLowerCase()}` });
    });

    console.log('🤖 Bot Telegram démarré (polling)');
  } catch(e) {
    console.error('Erreur démarrage bot:', e.message);
  }
}

startBot();

// ── MIDDLEWARE ADMIN ──
function adminAuth(req, res, next) {
  const token = req.headers['x-admin'];
  if (token && token === db.getSettings().adminToken) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ═══════════════════════════════════
// API ROUTES
// ═══════════════════════════════════

// ── AUTH ADMIN ──
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const settings = db.getSettings();
  if (password === settings.adminPwd) {
    res.json({ ok: true, token: settings.adminToken });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

// ── CATEGORIES ──
app.get('/api/categories', (req, res) => {
  res.json(db.getCategories());
});

app.post('/api/categories', adminAuth, (req, res) => {
  const cat = { id: 'cat' + Date.now(), ...req.body };
  db.addCategory(cat);
  res.json(cat);
});

app.put('/api/categories/:id', adminAuth, (req, res) => {
  db.updateCategory({ id: req.params.id, ...req.body });
  res.json({ ok: true });
});

app.delete('/api/categories/:id', adminAuth, (req, res) => {
  db.deleteCategory(req.params.id);
  res.json({ ok: true });
});

// ── PRODUCTS ──
app.get('/api/products', (req, res) => {
  res.json(db.getProducts());
});

app.post('/api/products', adminAuth, (req, res) => {
  const p = { id: 'p' + Date.now(), ...req.body };
  db.addProduct(p);
  res.json(p);
});

app.put('/api/products/:id', adminAuth, (req, res) => {
  db.updateProduct({ id: req.params.id, ...req.body });
  res.json({ ok: true });
});

app.delete('/api/products/:id', adminAuth, (req, res) => {
  db.deleteProduct(req.params.id);
  res.json({ ok: true });
});

// ── ORDERS ──
app.get('/api/orders', (req, res) => {
  const adminToken = req.headers['x-admin'];
  const userId = req.headers['x-user-id'];

  if (adminToken === db.getSettings().adminToken) {
    return res.json(db.getOrders());
  }
  if (userId) {
    return res.json(db.getOrders().filter(o => String(o.userId) === String(userId)));
  }
  res.status(401).json({ error: 'Non autorisé' });
});

app.post('/api/orders', upload.fields([
  { name: 'proof', maxCount: 1 },
  { name: 'orderFile', maxCount: 1 }
]), async (req, res) => {
  let data;
  try { data = JSON.parse(req.body.orderData); } catch(e) { return res.status(400).json({ error: 'Données invalides' }); }

  const orderId = 'FB-' + Date.now().toString(36).toUpperCase();
  const order = {
    id: orderId,
    userId: data.userId,
    userName: data.userName,
    username: data.username || '',
    productId: data.productId,
    productName: data.productName,
    catId: data.catId,
    catName: data.catName || '',
    price: data.price,
    text: data.text || '',
    payMethod: data.payMethod,
    status: 'paid',
    date: new Date().toISOString(),
    proofFile: req.files?.proof?.[0]?.filename || null,
    orderFile: req.files?.orderFile?.[0]?.filename || null
  };

  db.addOrder(order);

  // Notifications Telegram
  const settings = db.getSettings();
  if (bot && settings.adminUid) {
    try {
      const msg = `🆕 *NOUVELLE COMMANDE — FEUR BOXING*\n\n📦 *${order.productName}*\n🗂 ${order.catName}\n💰 *€${order.price}*\n💳 ${order.payMethod?.toUpperCase()}\n\n👤 *${order.userName}*${order.username ? ' (@' + order.username + ')' : ''}\n🆔 \`${order.userId}\`\n📋 ${order.text || '_(fichier joint)_'}\n🗓 ${new Date().toLocaleString('fr-FR')}\n🔑 \`${orderId}\``;

      await bot.sendMessage(settings.adminUid, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirmer', callback_data: 'confirm_' + orderId },
            { text: '🔄 En traitement', callback_data: 'processing_' + orderId },
            { text: '❌ Refuser', callback_data: 'refuse_' + orderId }
          ]]
        }
      });

      // Envoyer la preuve de paiement
      if (req.files?.proof?.[0]) {
        const f = req.files.proof[0];
        const caption = `📸 Preuve de paiement — \`${orderId}\``;
        if (f.mimetype === 'application/pdf') {
          await bot.sendDocument(settings.adminUid, f.path, { caption, parse_mode: 'Markdown' });
        } else {
          await bot.sendPhoto(settings.adminUid, f.path, { caption, parse_mode: 'Markdown' });
        }
      }

      // Envoyer le fichier/doc de la commande
      if (req.files?.orderFile?.[0]) {
        const f = req.files.orderFile[0];
        const caption = `📎 Document client — \`${orderId}\` — ${order.productName}`;
        if (f.mimetype === 'application/pdf') {
          await bot.sendDocument(settings.adminUid, f.path, { caption, parse_mode: 'Markdown' });
        } else {
          await bot.sendPhoto(settings.adminUid, f.path, { caption, parse_mode: 'Markdown' });
        }
      }
    } catch(e) {
      console.error('Erreur notification Telegram:', e.message);
    }
  }

  res.json({ ok: true, orderId });
});

app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  order.status = status;
  db.updateOrder(order);

  // Notifier le client
  if (bot && order.userId) {
    const msgs = {
      confirmed: `✅ *Votre commande a été confirmée !*\n\n📦 *${order.productName}*\n💰 €${order.price}\n\nMerci de votre confiance. — FEUR BOXING`,
      refused: `❌ *Votre commande a été refusée.*\n\n📦 *${order.productName}*\n\nContactez notre support : @feurman1`,
      processing: `🔄 *Votre commande est en cours de traitement.*\n\n📦 *${order.productName}*`
    };
    if (msgs[status]) {
      try { await bot.sendMessage(order.userId, msgs[status], { parse_mode: 'Markdown' }); } catch(e) {}
    }
  }

  res.json({ ok: true });
});

// ── PAYMENT SETTINGS (public, sans mot de passe) ──
app.get('/api/payment-settings', (req, res) => {
  const s = db.getSettings();
  res.json({ sol: s.sol, btc: s.btc, ltc: s.ltc, viro: s.viro });
});

// ── SETTINGS ADMIN ──
app.get('/api/settings', adminAuth, (req, res) => {
  res.json(db.getSettings());
});

app.put('/api/settings', adminAuth, (req, res) => {
  const allowed = ['adminUid', 'botToken', 'botUsername', 'webappUrl', 'adminPwd', 'sol', 'btc', 'ltc', 'viro'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  db.updateSettings(update);
  // Redémarrer le bot si le token a changé
  if (req.body.botToken) setTimeout(startBot, 500);
  res.json({ ok: true });
});

// ── STATS ADMIN ──
app.get('/api/stats', adminAuth, (req, res) => {
  const orders = db.getOrders();
  const products = db.getProducts();
  const revenue = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.price, 0);
  const pending = orders.filter(o => o.status === 'paid').length;
  const confirmed = orders.filter(o => o.status === 'confirmed').length;

  const pSales = {};
  orders.forEach(o => {
    if (!pSales[o.productId]) pSales[o.productId] = { name: o.productName, catName: o.catName, sales: 0, revenue: 0 };
    pSales[o.productId].sales++;
    pSales[o.productId].revenue += o.price;
  });
  const topProducts = Object.values(pSales).sort((a, b) => b.sales - a.sales).slice(0, 8);

  res.json({ total: orders.length, revenue, pending, confirmed, topProducts });
});

// ── DÉMARRAGE ──
app.listen(PORT, () => {
  console.log(`\n🚀 FEUR BOXING démarré → http://localhost:${PORT}`);
  console.log(`🔐 Panel admin → http://localhost:${PORT}/#admin`);
  console.log(`🗝  Mot de passe par défaut : admin2024\n`);
});
