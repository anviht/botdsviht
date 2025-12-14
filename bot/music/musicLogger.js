const db = require('../libs/db');

/**
 * Логирует воспроизведение песни в канал логов
 * Формат: dd.mm.yyyy hh:mm - Пользователь - Песня (Voice Channel Name)
 */
async function logMusicPlay(guild, userId, trackData, voiceChannelName) {
  try {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = config.musicLogChannelId || '1445848232965181500';
    
    // Получаем время в формате dd.mm.yyyy hh:mm
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `${day}.${month}.${year} ${hours}:${minutes}`;
    
    //获取用户信息
    const user = guild.client ? await guild.client.users.fetch(userId).catch(() => null) : null;
    const username = user ? user.username : `User#${userId}`;
    
    // Получаем название трека
    const trackTitle = trackData && trackData.title ? trackData.title : trackData;
    
    // Формируем логовое сообщение
    const logMessage = `📻 ${timestamp} - **${username}** - \`${trackTitle}\` (${voiceChannelName || 'Unknown Voice'})`;
    
    // ❌ ОТКЛЮЧЕНО: Отправка лог-сообщения в канал (раздражало юзеров)
    // if (guild.client) {
    //   const logChannel = await guild.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    //   if (logChannel && logChannel.isTextBased()) {
    //     try { await logChannel.send(logMessage).catch(e => console.error('Failed to send log message:', e && e.message)); } catch (e) { console.error('Failed to send log message:', e && e.message); }
    //   }
    // }
    
    // Сохраняем в базу данных для хистории
    const musicLogs = db.get('musicLogs') || [];
    musicLogs.push({
      userId: userId,
      guildId: guild.id,
      trackTitle: trackTitle,
      voiceChannel: voiceChannelName || 'Unknown',
      timestamp: new Date().toISOString(),
      formattedTime: timestamp
    });
    
    // Сохраняем только последние 1000 логов
    if (musicLogs.length > 1000) {
      musicLogs.splice(0, musicLogs.length - 1000);
    }
    
    await db.set('musicLogs', musicLogs);
    
  } catch (err) {
    console.error('musicLogger error:', err.message);
  }
}

/**
 * Получает логи прослушивания песен
 */
async function getMusicLogs(guildId, limit = 50) {
  try {
    await db.ensureReady();
    const musicLogs = db.get('musicLogs') || [];
    return musicLogs
      .filter(log => log.guildId === guildId)
      .slice(-limit)
      .reverse();
  } catch (err) {
    console.error('getMusicLogs error:', err.message);
    return [];
  }
}

/**
 * Получает логи конкретного пользователя
 */
async function getUserMusicLogs(userId, guildId, limit = 20) {
  try {
    await db.ensureReady();
    const musicLogs = db.get('musicLogs') || [];
    return musicLogs
      .filter(log => log.userId === userId && log.guildId === guildId)
      .slice(-limit)
      .reverse();
  } catch (err) {
    console.error('getUserMusicLogs error:', err.message);
    return [];
  }
}

/**
 * Получает топ песен за неделю на сервере
 */
async function getWeeklyTopTracks(guildId, limit = 10) {
  try {
    await db.ensureReady();
    const musicLogs = db.get('musicLogs') || [];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const weeklyLogs = musicLogs.filter(log => {
      return log.guildId === guildId && new Date(log.timestamp) > oneWeekAgo;
    });
    
    // Подсчитываем количество воспроизведений каждой песни
    const trackCounts = {};
    weeklyLogs.forEach(log => {
      const title = log.trackTitle;
      trackCounts[title] = (trackCounts[title] || 0) + 1;
    });
    
    // Сортируем по количеству воспроизведений
    const topTracks = Object.entries(trackCounts)
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    
    return topTracks;
  } catch (err) {
    console.error('getWeeklyTopTracks error:', err.message);
    return [];
  }
}

module.exports = {
  logMusicPlay,
  getMusicLogs,
  getUserMusicLogs,
  getWeeklyTopTracks
};
