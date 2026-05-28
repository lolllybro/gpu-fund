# 🤝 GPU Fund — NVIDIA Project DIGITS

Crypto donation tracker — raising **$5,000** for NVIDIA GB10 Superchip.

## Supported networks
- **TON** — via TON Center API
- **SOL** — via Solana JSON-RPC

---

## 🚀 Quick start

```bash
# 1. Install dependencies
npm install

# 2. Edit halal.env — add your wallets & keys
nano halal.env

# 3. Run
node server.js

# Open → http://localhost:3000
```

---

## 🌐 Production deploy (VPS)

```bash
# Install PM2
npm install -g pm2

# Start app
pm2 start ecosystem.config.js

# Auto-start on reboot
pm2 startup
pm2 save

# View logs
pm2 logs gpu-fund

# Setup nginx + SSL
sudo apt install nginx certbot python3-certbot-nginx
sudo cp nginx.conf /etc/nginx/sites-available/gpufund
sudo ln -s /etc/nginx/sites-available/gpufund /etc/nginx/sites-enabled/
# Edit yourdomain.com in nginx.conf, then:
sudo certbot --nginx -d yourdomain.com
```

---

## 📁 Project structure

```
gpu-fund/
├── server.js              # Express + Socket.io + TON/SOL parsers
├── client/
│   └── index.html         # Frontend (SPA, no build needed)
├── donations.db           # SQLite (auto-created)
├── halal.env              # Configuration
├── package.json
├── ecosystem.config.js    # PM2 config
├── nginx.conf             # Nginx reverse proxy + SSL
└── logs/                  # PM2 logs
```

---

## ⚙️ How it works

1. Every **30 seconds** server polls TON Center API and Solana RPC
2. New transactions are parsed — amount, sender, memo extracted
3. Donor name & message extracted from **memo/comment** field
4. Data saved to SQLite, broadcasted via **WebSocket (Socket.io)**
5. TON/SOL prices updated from CoinGecko every 5 minutes
6. Optional **Telegram** notification on each new donation

---

## 💬 Memo format

```
name:YourName message:Your message here
```

Examples:
- `name:CryptoFan message:Good luck!`
- `name:Alice`
- *(empty → shows as Anonymous)*

---

## 🔌 REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Stats (progress, prices, wallets) |
| GET | `/api/donations` | List donations (filter: network, search, limit, offset) |
| GET | `/api/export.csv` | Download all donations as CSV |
| GET | `/api/health` | Health check (uptime, prices) |
| POST | `/api/poll` | Trigger manual blockchain poll |

---

## 🤖 Telegram notifications (optional)

1. Create bot: [@BotFather](https://t.me/BotFather) → `/newbot`
2. Get your chat ID: [@userinfobot](https://t.me/userinfobot)
3. Add to `halal.env`:
```env
TG_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxx
TG_CHAT_ID=-100xxxxxxxxxx
```

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| express | HTTP server |
| socket.io | WebSocket for live updates |
| sql.js | SQLite (pure JS, no native build) |
| axios | HTTP requests to APIs |
| cors | CORS headers |
| dotenv | Environment variables |
