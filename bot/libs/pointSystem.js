const db = require('./db');
const { EmbedBuilder } = require('discord.js');

// ============================================
// СИСТЕМА ОЧКОВ И УРОВНЕЙ (ЕДИНАЯ)
// ============================================

const LEVEL_CONFIG = {
  maxLevel: 100,
  pointsPerLevel: 100, // каждый уровень требует 100 очков
};

const MESSAGE_MILESTONES = [100, 500, 1000, 2000, 5000, 10000, 15000, 20000, 50000];
const MESSAGE_REWARD = 50; // за каждую веху 50 очков

// ============================================
//게임 НАСТРОЙКИ НАГРАД
// ============================================

const GAME_REWARDS = {
  flip: { base: 10, max: 15, winChance: 0.5, name: '🪙 Орёл/Решка' },
  dice: { base: 20, max: 30, winChance: 0.5, name: '🎲 Кубики' },
  roulette: { base: 100, max: 150, winChance: 0.1667, name: '🎡 Рулетка' },
  rockpaper: { base: 25, max: 40, winChance: 0.33, name: '✂️ Камень-Ножницы-Бумага' },
  slots: { base: 50, max: 200, winChance: 0.25, name: '🎰 Слоты' },
  higher: { base: 15, max: 25, winChance: 0.5, name: '📈 Выше/Ниже' },
};

// ============================================
// СИСТЕМА ДОСТИЖЕНИЙ (20 штук)
// ============================================

const ACHIEVEMENTS = {
  // 🎯 Базовые
  'first_command': { name: '🎯 Первый шаг', description: 'Использовать первую команду', icon: '🎯' },
  'first_game': { name: '🎮 Геймер', description: 'Выиграть первую игру', icon: '🎮' },
  'first_message': { name: '💬 Голос', description: 'Написать первое сообщение', icon: '💬' },
  
  // ⭐ Очки/Уровни
  'points_500': { name: '⭐ Новичок', description: 'Набрать 500 очков', icon: '⭐' },
  'points_2000': { name: '✨ Опытный', description: 'Набрать 2000 очков', icon: '✨' },
  'points_5000': { name: '🌟 Мастер', description: 'Набрать 5000 очков', icon: '🌟' },
  'points_10000': { name: '👑 Легенда', description: 'Набрать 10000 очков', icon: '👑' },
  'points_25000': { name: '💎 Святой', description: 'Набрать 25000 очков', icon: '💎' },
  
  // 🏆 Победы в играх
  'wins_25': { name: '🏆 Победитель', description: 'Выиграть 25 игр', icon: '🏆' },
  'wins_100': { name: '🥇 Чемпион', description: 'Выиграть 100 игр', icon: '🥇' },
  'wins_500': { name: '👹 Монстр', description: 'Выиграть 500 игр', icon: '👹' },
  
  // 💬 Сообщения
  'messages_1000': { name: '🗣️ Болтун', description: 'Написать 1000 сообщений', icon: '🗣️' },
  'messages_10000': { name: '📢 Оратор', description: 'Написать 10000 сообщений', icon: '📢' },
  'messages_50000': { name: '🔊 Трубадур', description: 'Написать 50000 сообщений', icon: '🔊' },
  
  // 🎪 Специальные
  'win_streak_10': { name: '🔥 На волне', description: '10 побед подряд', icon: '🔥' },
  'play_all_games': { name: '🎯 Универсал', description: 'Сыграть во все игры', icon: '🎯' },
  'level_50': { name: '💪 Полусотня', description: 'Достичь уровня 50', icon: '💪' },
  'level_100': { name: '🚀 Апофеоз', description: 'Достичь уровня 100', icon: '🚀' },
};

// ============================================
// СИСТЕМА ОЧКОВ - ОСНОВНЫЕ ФУНКЦИИ
// ============================================

/**
 * Добавить очки игроку
 */
async function addPoints(userId, points, reason = 'unknown') {
  try {
    await db.ensureReady();
    
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {} };
    }
    
    gameStats[userId].points = (gameStats[userId].points || 0) + points;
    await db.set('gameStats', gameStats);
    
    console.log(`[POINTS] +${points} для ${userId} (причина: ${reason})`);
    return gameStats[userId].points;
    
  } catch (e) {
    console.error('[POINTS] Error adding points:', e);
    return 0;
  }
}

/**
 * Получить уровень по очкам
 */
function getLevel(points) {
  return Math.floor(points / LEVEL_CONFIG.pointsPerLevel) + 1;
}

/**
 * Получить очки нужные для текущего уровня
 */
function getLevelProgress(points) {
  const level = getLevel(points);
  const pointsForLevel = (level - 1) * LEVEL_CONFIG.pointsPerLevel;
  const nextLevelPoints = level * LEVEL_CONFIG.pointsPerLevel;
  const current = points - pointsForLevel;
  const needed = LEVEL_CONFIG.pointsPerLevel;
  
  return {
    level,
    current,
    needed,
    percent: Math.floor((current / needed) * 100)
  };
}

/**
 * Записать победу в игре
 */
async function recordGameWin(userId, game, pointsEarned) {
  try {
    await db.ensureReady();
    
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {} };
    }
    
    gameStats[userId].wins = (gameStats[userId].wins || 0) + 1;
    gameStats[userId].gamesPlayed = gameStats[userId].gamesPlayed || {};
    gameStats[userId].gamesPlayed[game] = (gameStats[userId].gamesPlayed[game] || 0) + 1;
    
    await db.set('gameStats', gameStats);
    
  } catch (e) {
    console.error('[GAME] Error recording win:', e);
  }
}

/**
 * Записать поражение в игре
 */
async function recordGameLoss(userId, game) {
  try {
    await db.ensureReady();
    
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {} };
    }
    
    gameStats[userId].losses = (gameStats[userId].losses || 0) + 1;
    gameStats[userId].gamesPlayed = gameStats[userId].gamesPlayed || {};
    gameStats[userId].gamesPlayed[game] = (gameStats[userId].gamesPlayed[game] || 0) + 1;
    
    await db.set('gameStats', gameStats);
    
  } catch (e) {
    console.error('[GAME] Error recording loss:', e);
  }
}

/**
 * Добавить сообщение пользователю и проверить вехи
 */
async function addMessage(userId, client) {
  try {
    await db.ensureReady();
    
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {}, achievements: [] };
    }
    
    gameStats[userId].messagesCount = (gameStats[userId].messagesCount || 0) + 1;
    const msgCount = gameStats[userId].messagesCount;
    
    await db.set('gameStats', gameStats);
    
    // Проверяем достижения за сообщения
    await checkMessageAchievements(userId, msgCount, client);
    
    // Проверяем вехи и даём награды
    for (const milestone of MESSAGE_MILESTONES) {
      if (msgCount === milestone) {
        await addPoints(userId, MESSAGE_REWARD, `messages_${milestone}`);
        console.log(`[MESSAGES] Веха достигнута: ${msgCount} для ${userId}`);
        return milestone; // вернём какую веху достигли
      }
    }
    
    return null;
    
  } catch (e) {
    console.error('[MESSAGES] Error:', e);
  }
}
      }
    }
    
  } catch (e) {
    console.error('[MESSAGES] Error adding message:', e);
  }
  return null;
}

// ============================================
// СИСТЕМА ДОСТИЖЕНИЙ
// ============================================

/**
 * Добавить достижение игроку
 */
async function addAchievement(userId, key, client) {
  try {
    await db.ensureReady();
    
    // Сохранять в gameStats, а не в отдельный achievements объект
    const gameStats = db.get('gameStats') || {};
    if (!gameStats[userId]) {
      gameStats[userId] = { points: 0, wins: 0, losses: 0, messagesCount: 0, gamesPlayed: {}, achievements: [] };
    }
    
    if (gameStats[userId].achievements.includes(key)) return false; // уже есть
    
    gameStats[userId].achievements.push(key);
    await db.set('gameStats', gameStats);
    
    console.log(`[ACH] Новое достижение: ${key} для ${userId}`);
    
    // Отправить уведомление в ЛС
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        const ach = ACHIEVEMENTS[key] || { name: key, description: '', icon: '🎖️' };
        const embed = new EmbedBuilder()
          .setTitle('🏅 ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!')
          .setDescription(`${ach.icon} **${ach.name}**\n${ach.description}`)
          .setColor(0xFFD700)
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp();
        
        await user.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (e) {
      console.warn('[ACH] DM ошибка:', e.message);
    }
    
    return true;
    
  } catch (e) {
    console.error('[ACH] Error:', e);
    return false;
  }
}

/**
 * Проверить достижения после игры
 */
async function checkGameAchievements(userId, game, client) {
  try {
    await db.ensureReady();
    
    const gameStats = db.get('gameStats') || {};
    const stats = gameStats[userId] || {};
    
    // Первая игра
    if (stats.wins >= 1) await addAchievement(userId, 'first_game', client);
    
    // Достижения по количеству побед
    if (stats.wins >= 25) await addAchievement(userId, 'wins_25', client);
    if (stats.wins >= 100) await addAchievement(userId, 'wins_100', client);
    if (stats.wins >= 500) await addAchievement(userId, 'wins_500', client);
    
    // Проверить, сыграл ли во все игры
    const gamesPlayed = Object.keys(stats.gamesPlayed || {});
    if (gamesPlayed.length >= 6) {
      await addAchievement(userId, 'play_all_games', client);
    }
    
  } catch (e) {
    console.error('[ACH-GAME] Error:', e);
  }
}

/**
 * Проверить достижения по очкам
 */
async function checkPointAchievements(userId, points, client) {
  try {
    if (points >= 500) await addAchievement(userId, 'points_500', client);
    if (points >= 2000) await addAchievement(userId, 'points_2000', client);
    if (points >= 5000) await addAchievement(userId, 'points_5000', client);
    if (points >= 10000) await addAchievement(userId, 'points_10000', client);
    if (points >= 25000) await addAchievement(userId, 'points_25000', client);
    
    const level = getLevel(points);
    if (level >= 50) await addAchievement(userId, 'level_50', client);
    if (level >= 100) await addAchievement(userId, 'level_100', client);
    
  } catch (e) {
    console.error('[ACH-POINTS] Error:', e);
  }
}

/**
 * Проверить достижения по сообщениям
 */
async function checkMessageAchievements(userId, messagesCount, client) {
  try {
    if (messagesCount >= 1) await addAchievement(userId, 'first_message', client);
    if (messagesCount >= 1000) await addAchievement(userId, 'messages_1000', client);
    if (messagesCount >= 10000) await addAchievement(userId, 'messages_10000', client);
    if (messagesCount >= 50000) await addAchievement(userId, 'messages_50000', client);
    
  } catch (e) {
    console.error('[ACH-MSG] Error:', e);
  }
}

/**
 * Проверить достижение за первую команду
 */
async function checkFirstCommand(userId, client) {
  try {
    await addAchievement(userId, 'first_command', client);
  } catch (e) {
    console.error('[ACH-CMD] Error:', e);
  }
}

// ============================================
// ФУНКЦИЯ УВЕДОМЛЕНИЙ ДЛЯ ВСЕХ ИГР
// ============================================

async function notifyReward(interaction, userId, reward, gameName, emoji) {
  try {
    if (reward === 0) return;
    
    // DM - красивое embed
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle(`${emoji} Победа в ${gameName}!`)
        .setDescription(`+${reward} очков`)
        .setColor(0x00AA00)
        .setThumbnail(user.displayAvatarURL());
      await user.send({ embeds: [embed] }).catch(() => {});
    }

    // Flood channel - минимальное сообщение
    const floodChannel = await interaction.client.channels.fetch('1448411376291938336').catch(() => null);
    if (floodChannel) {
      await floodChannel.send(`<@${userId}> ${emoji} +${reward} очков в ${gameName}`).catch(() => {});
    }
  } catch (e) {
    console.warn('[NOTIFY] Error:', e && e.message ? e.message : e);
  }
}

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = {
  // Настройки
  GAME_REWARDS,
  ACHIEVEMENTS,
  LEVEL_CONFIG,
  MESSAGE_MILESTONES,
  MESSAGE_REWARD,
  
  // Функции очков
  addPoints,
  getLevel,
  getLevelProgress,
  recordGameWin,
  recordGameLoss,
  addMessage,
  
  // Функции достижений
  addAchievement,
  checkGameAchievements,
  checkPointAchievements,
  checkMessageAchievements,
  checkFirstCommand,
  
  // Функция уведомлений
  notifyReward,
};
