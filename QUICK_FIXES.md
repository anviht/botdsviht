# 🔧 ГОТОВЫЕ РЕШЕНИЯ ДЛЯ КРИТИЧЕСКИХ ПРОБЛЕМ

> Копируй-вставляй решения для немедленного исправления проблем

---

## 1️⃣ ИСПРАВЛЕНИЕ УТЕЧКИ ПАМЯТИ: processedMessages

**Файл:** `bot/index.js`  
**Найди около строки 1420:**

```javascript
const processedMessages = new Set(); // Track processed messages
```

**Замени на:**

```javascript
class MessageCache {
  constructor(maxSize = 100000, ttl = 300000) { // 5 мин TTL
    this.messages = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cleanup();
  }
  
  has(id) {
    if (!this.messages.has(id)) return false;
    const entry = this.messages.get(id);
    if (Date.now() - entry.time > this.ttl) {
      this.messages.delete(id);
      return false;
    }
    return true;
  }
  
  add(id) {
    this.messages.set(id, { time: Date.now() });
    
    // Удаляем самые старые если превышен размер
    if (this.messages.size > this.maxSize) {
      const toDelete = Math.floor(this.maxSize * 0.1);
      for (const [key, _] of this.messages.entries()) {
        this.messages.delete(key);
        if (--toDelete <= 0) break;
      }
    }
  }
  
  cleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.messages.entries()) {
        if (now - entry.time > this.ttl) {
          this.messages.delete(id);
        }
      }
    }, 60000); // каждую минуту
  }
}

const processedMessages = new MessageCache();
```

**В client.on('messageCreate') замени:**
```javascript
// СТАРО:
if (processedMessages.has(message.id)) return;
processedMessages.add(message.id);

// НОВО:
if (processedMessages.has(message.id)) return;
processedMessages.add(message.id);
```

---

## 2️⃣ ИСПРАВЛЕНИЕ УТЕЧКИ ПАМЯТИ: lastMessageAt

**Файл:** `bot/index.js`  
**Найди около строки 1407:**

```javascript
const lastMessageAt = new Map();
```

**Замени на:**

```javascript
const lastMessageAt = new Map();
const COOLDOWN_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа

// Периодическая очистка старых записей
setInterval(() => {
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
  
  for (const [userId, timestamp] of lastMessageAt.entries()) {
    if (now - timestamp > maxAge) {
      lastMessageAt.delete(userId);
    }
  }
  
  console.log(`[COOLDOWN] Cleaned up. Current users: ${lastMessageAt.size}`);
}, COOLDOWN_CLEANUP_INTERVAL);
```

---

## 3️⃣ ИСПРАВЛЕНИЕ УТЕЧКИ В playerManager

**Файл:** `bot/music/playerManager.js`  
**Найди конец класса (перед module.exports):**

```javascript
module.exports = new PlayerManager();
```

**Замени на:**

```javascript
module.exports = new PlayerManager();

// Добавить эту функцию в класс PlayerManager:
// (добавь перед module.exports)

PlayerManager.prototype.cleanupGuild = function(guildId) {
  const player = this.players.get(guildId);
  const connection = this.connections.get(guildId);
  
  if (player) {
    try { player.stop(); } catch (e) {}
    this.players.delete(guildId);
  }
  if (connection) {
    try { connection.destroy(); } catch (e) {}
    this.connections.delete(guildId);
  }
  this.queue.delete(guildId);
  this.nowPlaying.delete(guildId);
};

// И добавить интервал очистки
setInterval(() => {
  const now = Date.now();
  const timeout = 60 * 60 * 1000; // 1 час
  
  // Нужно отслеживать последнюю активность для каждой гильдии
  // Это требует модификации методов play/skip/stop
  
  console.log(`[PLAYER] Queue sizes: ${playerManager.queue.size} guilds active`);
}, 5 * 60 * 1000); // каждые 5 минут отчёт
```

---

## 4️⃣ СИНХРОНИЗАЦИЯ DB ОПЕРАЦИЙ

**Файл:** `bot/libs/db.js`  
**Замени весь файл на:**

```javascript
const path = require('path');

let db = null;
let dbInitialized = false;
let dbLock = Promise.resolve(); // Система лок

async function withDbLock(fn) {
  return new Promise((resolve, reject) => {
    dbLock = dbLock.then(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }).catch(e => {
      console.error('[DB] Lock error:', e.message);
      reject(e);
    });
  });
}

async function initDb() {
  if (db) return db;
  const { Low, JSONFile } = await import('lowdb');
  const dbFile = path.join(__dirname, '..', '..', 'db.json');
  const adapter = new JSONFile(dbFile);
  db = new Low(adapter);
  await db.read();
  db.data = db.data || { welcome: null, stats: { aiRequests: 0 }, rulesPosted: null, supportPanelPosted: null };
  await db.write();
  dbInitialized = true;
  return db;
}

let dbReady = initDb().catch(e => console.error('DB init error:', e));

module.exports = {
  ensureReady: () => dbReady,
  
  set: async (k, v) => {
    return withDbLock(async () => {
      await dbReady;
      if (!db || !db.data) {
        throw new Error('DB not initialized for set: ' + k);
      }
      db.data[k] = v;
      try {
        await db.write();
      } catch (e) {
        if (e.code !== 'EPERM') throw e;
        console.warn('DB write warning (EPERM):', e.message);
      }
      return db.data[k];
    });
  },
  
  get: async (k) => {
    return withDbLock(async () => {
      await dbReady;
      if (!dbInitialized || !db || !db.data) {
        console.warn('DB not yet initialized for get:', k);
        return null;
      }
      return db.data[k];
    });
  },
  
  incrementAi: async () => {
    return withDbLock(async () => {
      await dbReady;
      if (!db || !db.data) {
        throw new Error('DB not initialized for incrementAi');
      }
      try {
        db.data.stats = db.data.stats || { aiRequests: 0 };
        db.data.stats.aiRequests = (db.data.stats.aiRequests || 0) + 1;
        await db.write();
      } catch (e) {
        if (e.code === 'EPERM') {
          console.warn('DB write warning (file locked): incrementAi not persisted this time');
        } else {
          throw e;
        }
      }
    });
  },
  
  all: async () => {
    return withDbLock(async () => {
      await dbReady;
      if (!dbInitialized || !db || !db.data) {
        console.warn('DB not yet initialized for all');
        return null;
      }
      return db.data;
    });
  }
};
```

⚠️ **ВАЖНО:** Потребуется обновить все вызовы `db.get()` на `await db.get()` и `db.all()` на `await db.all()`!

---

## 5️⃣ ИСПРАВЛЕНИЕ SETINTERVAL БЕЗ ОЧИСТКИ

**Файл:** `bot/index.js`  
**Найди около строки 1355:**

```javascript
setInterval(async () => {
  // DM cleanup...
}, 3600000);
```

**Замени на:**

```javascript
let dmCleanupIntervalId = null;

function startDmCleanup() {
  dmCleanupIntervalId = setInterval(async () => {
    try {
      const dmMenu = require('./dm-menu');
      const startTime = Date.now();
      let processed = 0;
      
      for (const guild of client.guilds.cache.values()) {
        const members = await guild.members.fetch({ limit: 100 }).catch(() => null);
        if (!members) continue;
        
        for (const member of members.values()) {
          if (member.user.bot) continue;
          await dmMenu.cleanupOldMenuMessages(member.user, client).catch(() => {});
          processed++;
          
          // Не обрабатывать слишком долго
          if (Date.now() - startTime > 30000) { // 30 сек макс
            console.warn('[DM_CLEANUP] Timeout, pausing cleanup');
            return;
          }
          
          await new Promise(r => setTimeout(r, 50));
        }
      }
      
      console.log(`[DM_CLEANUP] Processed ${processed} members in ${Date.now() - startTime}ms`);
    } catch (err) {
      console.error('Hourly DM cleanup error:', err.message);
    }
  }, 3600000); // 1 час
  
  console.log('[DM_CLEANUP] Started');
}

// При готовности бота
client.once('ready', async () => {
  // ... другой код ...
  
  // Запускаем DM cleanup
  startDmCleanup();
});

// При выключении
async function gracefulShutdown(signal) {
  try {
    console.log(`[Shutdown] Received ${signal}`);
    
    if (dmCleanupIntervalId) {
      clearInterval(dmCleanupIntervalId);
      console.log('[Shutdown] DM cleanup interval cleared');
    }
    
    if (client && client.user) {
      try { await client.destroy(); } catch (e) { console.warn('Error destroying client', e && e.message); }
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Error during gracefulShutdown', e && e.message ? e.message : e);
    process.exit(1);
  }
}
```

---

## 6️⃣ РАЗБРОСАТЬ SETINTERVAL ПАНЕЛЕЙ

**Файл:** `bot/index.js`  
**Найди около строки 1595:**

```javascript
setInterval(async () => {
  try {
    await ensureAiPanel().catch(e => console.warn('[PANEL] AI error:', e.message));
    await ensureMenuPanel(client).catch(...);
    // ...
  }
}, 5 * 60 * 1000);
```

**Замени на:**

```javascript
// Разные интервалы для каждой панели
const panelIntervals = {};

function startPanelUpdates() {
  // AI Panel - каждые 5 минут
  panelIntervals.ai = setInterval(() => {
    ensureAiPanel()
      .then(() => console.log('[PANEL] AI updated'))
      .catch(e => console.warn('[PANEL] AI error:', e.message));
  }, 5 * 60 * 1000 + Math.random() * 30000);
  
  // Menu Panel - каждые 5.5 минут
  panelIntervals.menu = setInterval(() => {
    ensureMenuPanel(client)
      .then(() => console.log('[PANEL] Menu updated'))
      .catch(e => console.warn('[PANEL] Menu error:', e.message));
  }, 5.5 * 60 * 1000 + Math.random() * 30000);
  
  // Music Panel - каждые 6 минут
  panelIntervals.music = setInterval(() => {
    const { updateMusicPanel } = require('./music/musicHandlers');
    updateMusicPanel(client)
      .then(() => console.log('[PANEL] Music updated'))
      .catch(e => console.warn('[PANEL] Music error:', e.message));
  }, 6 * 60 * 1000 + Math.random() * 30000);
  
  // Post Manager Panel - каждые 7 минут
  panelIntervals.manager = setInterval(() => {
    postPostManagerPanel(client)
      .then(() => console.log('[PANEL] Manager updated'))
      .catch(e => console.warn('[PANEL] Manager error:', e.message));
  }, 7 * 60 * 1000 + Math.random() * 30000);
  
  console.log('[PANEL] All panel updates scheduled');
}

// При готовности
client.once('ready', async () => {
  // ... другой код ...
  startPanelUpdates();
});

// При выключении
async function gracefulShutdown(signal) {
  // Очищаем панели
  for (const [name, id] of Object.entries(panelIntervals)) {
    if (id) {
      clearInterval(id);
      console.log(`[Shutdown] Panel interval ${name} cleared`);
    }
  }
  // ... остальное ...
}
```

---

## 7️⃣ ДОБАВИТЬ TIMEOUT НА ASYNC ОПЕРАЦИИ

**Файл:** `bot/music/musicHandlers.js` (или где нужно)  
**Добавь в начало:**

```javascript
// Утилита для timeout
async function withTimeout(promise, timeoutMs = 5000, operationName = 'Operation') {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    console.error(`[TIMEOUT] ${operationName}:`, error.message);
    throw error;
  }
}
```

**Использование:**

```javascript
// СТАРО:
async function handleMusicSearchSubmit(interaction) {
  const results = await playerManager.search(query);
  // ...
}

// НОВО:
async function handleMusicSearchSubmit(interaction) {
  try {
    const results = await withTimeout(
      playerManager.search(query),
      10000,
      'Music search'
    );
    // ...
  } catch (e) {
    if (e.message.includes('timeout')) {
      await interaction.editReply('⏱️ Поиск занял слишком долго. Попробуйте ещё раз.');
    } else {
      throw e;
    }
  }
}
```

---

## 8️⃣ УЛУЧШИТЬ ОБРАБОТКУ ОШИБОК

**Добавь логирование вместо молчаливых try-catch:**

```javascript
// СТАРО:
try {
  await points.checkGameAchievements(userId, 'dice', interaction.client);
} catch (e) {} // Молчит!

// НОВО:
try {
  await points.checkGameAchievements(userId, 'dice', interaction.client);
} catch (e) {
  console.error('[ACHIEVEMENTS] Error checking:', e.message);
  // Не прерываем игру, но логируем
}
```

---

## 9️⃣ ДОБАВИТЬ AWAIT НА DB.ensureReady()

**Файл:** `bot/libs/statsTracker.js`  
**Найди все функции типа:**

```javascript
// СТАРО:
function trackUserJoin(userId, guildId) {
  try {
    db.ensureReady(); // ❌ НЕ ЖДЁМ!
    const stats = db.get(STATS_KEY) || {};
```

**Замени на:**

```javascript
// НОВО:
async function trackUserJoin(userId, guildId) {
  try {
    await db.ensureReady(); // ✅ ЖДЁМ!
    const stats = await db.get(STATS_KEY) || {}; // ✅ Тоже await
```

**И обнови все вызовы в index.js:**

```javascript
// СТАРО:
statsTracker.trackUserJoin(member.id, member.guild.id);

// НОВО:
await statsTracker.trackUserJoin(member.id, member.guild.id);
```

---

## 🔟 БЫСТРЫЙ ФИКС ДЛЯ СРОЧНЫХ СЛУЧАЕВ

Если нет времени исправлять всё, сделай минимум:

```javascript
// 1. Добавь в конец index.js:
const interval1 = setInterval(() => {
  const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(`[MEMORY] ${Math.round(memUsage)} MB`);
  
  if (memUsage > 500) {
    console.warn('[MEMORY] HIGH MEMORY USAGE! Consider restarting bot.');
  }
}, 60000);

// 2. Добавь очистку при выключении
process.on('SIGINT', () => {
  clearInterval(interval1);
  if (dmCleanupIntervalId) clearInterval(dmCleanupIntervalId);
  process.exit(0);
});

// 3. Перезагружайся каждые 12 часов (PM2 или cron)
# В crontab (для автоматического перезапуска):
0 */12 * * * pm2 restart all
```

---

## ✅ ЧЕКЛИСТ ПРИМЕНЕНИЯ

```
Критические (применить СЕГОДНЯ):
- [ ] Добавлен MessageCache для processedMessages
- [ ] Добавлена очистка lastMessageAt
- [ ] playerManager имеет cleanup
- [ ] DB операции синхронизированы с lock
- [ ] setInterval имеет clearInterval

Важные (на неделю):
- [ ] Все catch() логируют ошибки
- [ ] Все db операции имеют await
- [ ] Timeout на длительные операции (search, fetch)
- [ ] Панели обновляются в разное время

Проверка:
- [ ] Бот не растёт в памяти за 24 часа
- [ ] Нет зависаний при большом трафике
- [ ] Данные не теряются при перезагрузке
```

---

**Создано:** 18 декабря 2025
