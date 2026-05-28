# 🚀 Deploy to Railway (Free)

## Пошаговый деплой за 5 минут

---

### Шаг 1 — GitHub аккаунт
Если нет — зарегистрируйся на https://github.com

---

### Шаг 2 — Создай репозиторий на GitHub

1. Зайди на https://github.com/new
2. Название: `gpu-fund`
3. Выбери **Private** (чтобы скрыть адреса кошельков в коде)
4. Нажми **Create repository**

---

### Шаг 3 — Загрузи файлы на GitHub

Открой терминал (или Git Bash на Windows):

```bash
# Перейди в папку с проектом
cd gpu-fund

# Инициализируй git
git init
git add .
git commit -m "initial commit"

# Подключи к GitHub (замени YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/gpu-fund.git
git branch -M main
git push -u origin main
```

---

### Шаг 4 — Railway аккаунт
1. Зайди на https://railway.app
2. Нажми **Login with GitHub**
3. Авторизуй Railway

---

### Шаг 5 — Создай проект на Railway

1. Нажми **New Project**
2. Выбери **Deploy from GitHub repo**
3. Найди `gpu-fund` и нажми **Deploy Now**
4. Railway автоматически запустит `npm install` и `node server.js`

---

### Шаг 6 — Добавь переменные окружения

В Railway → твой проект → вкладка **Variables** → добавь:

```
TON_WALLET    = UQADNsGWjhdTfSv4fei9cdfuUyx8zKtc0A8m0op2sXq_llQm
SOL_WALLET    = DT39PJjRN7zFcZk36PDRthxzP66Sw4AcpqL54QdesLsD
DONATION_GOAL = 5000
TON_API_KEY   = (опционально — с toncenter.com)
TG_BOT_TOKEN  = (опционально — для Telegram уведомлений)
TG_CHAT_ID    = (опционально)
```

> ⚠️ PORT не нужно добавлять — Railway ставит его автоматически

---

### Шаг 7 — Получи URL

1. Railway → вкладка **Settings** → раздел **Domains**
2. Нажми **Generate Domain**
3. Получишь URL типа: `https://gpu-fund-production.up.railway.app`

---

### Шаг 8 — Свой домен (опционально)

1. Купи домен на Namecheap (~$10/год для .com)
2. В Railway → Settings → Domains → **Add Custom Domain**
3. Введи свой домен
4. Railway покажет DNS записи — добавь их в Namecheap
5. SSL (HTTPS) включится автоматически через ~5 минут

---

## ✅ Готово!

Твой сайт онлайн. Railway бесплатный план включает:
- **$5 кредитов в месяц** (для этого проекта хватит на ~500 часов)
- Автоматический HTTPS
- Автоперезапуск при падении
- Логи в реальном времени

---

## 📊 Мониторинг

```
Railway Dashboard → твой проект → вкладка Deployments
```

Или открой: `https://твой-домен/api/health`

---

## 🔄 Обновление сайта

```bash
# После любых изменений:
git add .
git commit -m "update"
git push

# Railway автоматически передеплоит за ~1 минуту
```
