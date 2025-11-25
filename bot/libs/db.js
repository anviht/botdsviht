const path = require('path');
let db = null;
let dbInitialized = false;

// Initialize lowdb async
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

// Initialize on module load
let dbReady = initDb().catch(e => console.error('DB init error:', e));

module.exports = {
  // Ensure DB is ready before any operation
  ensureReady: () => dbReady,
  
  set: async (k, v) => { 
    await dbReady;
    if (!db || !db.data) { console.warn('DB not initialized for set'); return null; }
    db.data[k] = v; 
    try { 
      await db.write(); 
    } catch (e) { 
      if (e.code !== 'EPERM') throw e; 
      console.warn('DB write warning (EPERM):', e.message); 
    } 
    return db.data[k]; 
  },
  
  get: (k) => {
    if (!dbInitialized || !db || !db.data) { 
      console.warn('DB not yet initialized for get:', k);
      return null; 
    }
    return db.data[k];
  },
  
  incrementAi: async () => { 
    await dbReady;
    if (!db || !db.data) { console.warn('DB not initialized for incrementAi'); return; }
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
  },
  
  all: () => {
    if (!dbInitialized || !db || !db.data) { 
      console.warn('DB not yet initialized for all');
      return null; 
    }
    return db.data;
  }
};
