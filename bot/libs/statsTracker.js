const db = require('./db');

const STATS_KEY = 'serverStats';
const DAYS_TO_KEEP = 30;

/**
 * Инициализировать структуру статистики
 */
function initStats() {
  try {
    const stats = db.get(STATS_KEY) || {};
    if (!stats || typeof stats !== 'object') {
      db.set(STATS_KEY, {});
    }
  } catch (e) {
    console.error('[StatsTracker] Init error:', e.message);
  }
}

/**
 * Получить дату в формате YYYY-MM-DD
 */
function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Записать вход пользователя на сервер
 */
function trackUserJoin(userId, guildId) {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const dateKey = getDateKey();
    
    if (!stats[dateKey]) {
      stats[dateKey] = {
        joins: 0,
        boosts: 0,
        roles: {},
        users: []
      };
    }
    
    // Проверить что уже не учитывали этого юзера сегодня
    if (!stats[dateKey].users) stats[dateKey].users = [];
    if (!stats[dateKey].users.includes(userId)) {
      stats[dateKey].users.push(userId);
      stats[dateKey].joins = (stats[dateKey].joins || 0) + 1;
    }
    
    db.set(STATS_KEY, stats);
  } catch (e) {
    console.error('[StatsTracker] trackUserJoin error:', e.message);
  }
}

/**
 * Записать буст
 */
function trackBoost(userId, guildId) {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const dateKey = getDateKey();
    
    if (!stats[dateKey]) {
      stats[dateKey] = {
        joins: 0,
        boosts: 0,
        roles: {},
        users: []
      };
    }
    
    stats[dateKey].boosts = (stats[dateKey].boosts || 0) + 1;
    db.set(STATS_KEY, stats);
  } catch (e) {
    console.error('[StatsTracker] trackBoost error:', e.message);
  }
}

/**
 * Записать роль пользователя
 */
function trackUserRole(userId, roleName) {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const dateKey = getDateKey();
    
    if (!stats[dateKey]) {
      stats[dateKey] = {
        joins: 0,
        boosts: 0,
        roles: {},
        users: []
      };
    }
    
    if (!stats[dateKey].roles) stats[dateKey].roles = {};
    stats[dateKey].roles[roleName] = (stats[dateKey].roles[roleName] || 0) + 1;
    db.set(STATS_KEY, stats);
  } catch (e) {
    console.error('[StatsTracker] trackUserRole error:', e.message);
  }
}

/**
 * Получить статистику за последние N дней
 */
function getStatsForDays(days = 7) {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const result = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);
      
      if (stats[dateKey]) {
        result[dateKey] = stats[dateKey];
      }
    }
    
    return result;
  } catch (e) {
    console.error('[StatsTracker] getStatsForDays error:', e.message);
    return {};
  }
}

/**
 * Получить статистику за все время (30 дней)
 */
function getAllStats() {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const result = {};
    
    for (let i = 0; i < DAYS_TO_KEEP; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);
      
      if (stats[dateKey]) {
        result[dateKey] = stats[dateKey];
      }
    }
    
    return result;
  } catch (e) {
    console.error('[StatsTracker] getAllStats error:', e.message);
    return {};
  }
}

/**
 * Получить тестовую статистику (для демонстрации)
 */
function getTestStats() {
  const testData = {};
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = getDateKey(date);
    
    // Генерируем тестовые данные
    const baseJoins = Math.floor(Math.random() * 8) + 3; // 3-11 человек
    const boosts = Math.floor(Math.random() * 3);
    
    testData[dateKey] = {
      joins: baseJoins,
      boosts: boosts,
      roles: {
        'Member': baseJoins,
        'Premium': Math.floor(baseJoins * 0.3),
        'Admin': Math.floor(Math.random() * 2)
      },
      users: Array.from({ length: baseJoins }, (_, i) => `user_${i}`)
    };
  }
  
  return testData;
}

/**
 * Очистить старую статистику (старше 30 дней)
 */
function cleanupOldStats() {
  try {
    db.ensureReady();
    const stats = db.get(STATS_KEY) || {};
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
    const cutoffKey = getDateKey(cutoffDate);
    
    const newStats = {};
    Object.keys(stats).forEach(dateKey => {
      if (dateKey >= cutoffKey) {
        newStats[dateKey] = stats[dateKey];
      }
    });
    
    db.set(STATS_KEY, newStats);
  } catch (e) {
    console.error('[StatsTracker] cleanupOldStats error:', e.message);
  }
}

module.exports = {
  initStats,
  trackUserJoin,
  trackBoost,
  trackUserRole,
  getStatsForDays,
  getAllStats,
  getTestStats,
  cleanupOldStats,
  getDateKey
};
