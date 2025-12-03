const { EmbedBuilder } = require('discord.js');

function createMusicMenuEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🎵 Музыка')
    .setColor(0x9C27B0)
    .setDescription('Выберите источник музыки:')
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3899/3899618.png');
  return embed;
}

function createRadioListEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('📻 Выберите радиостанцию')
    .setColor(0xFF6B35)
    .setDescription('Нажмите на кнопку радиостанции, чтобы начать прослушивание:')
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/2966/2966751.png');
  return embed;
}

function createNowPlayingEmbed(radioLabel) {
  const embed = new EmbedBuilder()
    .setTitle('🎧 Сейчас играет')
    .setColor(0x4CAF50)
    .setDescription(`**${radioLabel}**`)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/2966/2966751.png')
    .addFields(
      { name: 'Статус', value: '▶️ Воспроизведение', inline: true }
    );
  return embed;
}

function createPlayerControlsEmbed(radioLabel) {
  const embed = new EmbedBuilder()
    .setTitle('🎵 Управление плеером')
    .setColor(0x9C27B0)
    .setDescription(`**Текущая станция:** ${radioLabel}`)
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/2966/2966751.png')
    .addFields(
      { name: 'Громкость', value: 'Используй кнопки - и +', inline: false },
      { name: 'Станция', value: 'Нажми "Другая станция" чтобы переключиться', inline: false }
    );
  return embed;
}

function createNowPlayingWithProgressEmbed(title, currentTime, duration, artist = 'Unknown') {
  const percent = Math.round((currentTime / duration) * 100);
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
  
  const embed = new EmbedBuilder()
    .setTitle('🎵 Сейчас играет')
    .setColor(0x4CAF50)
    .setDescription(`**${title}**`)
    .addFields(
      { name: 'Исполнитель', value: artist, inline: true },
      { name: 'Прогресс', value: `${progressBar}\n${formatTime(currentTime)} / ${formatTime(duration)}`, inline: false }
    );
  return embed;
}

function createHistoryEmbed(tracks) {
  const embed = new EmbedBuilder()
    .setTitle('📜 История воспроизведения')
    .setColor(0x2196F3)
    .setDescription(tracks.length > 0 ? 'Последние треки:' : 'История пуста');
  
  if (tracks.length > 0) {
    const desc = tracks.slice(0, 10).map((t, i) => `${i+1}. ${t.title || 'Неизвестно'}`).join('\n');
    embed.setDescription(desc);
  }
  return embed;
}

function createFavoritesEmbed(tracks) {
  const embed = new EmbedBuilder()
    .setTitle('❤️ Избранное')
    .setColor(0xFF1744)
    .setDescription(tracks.length > 0 ? 'Ваши любимые треки:' : 'Избранное пусто');
  
  if (tracks.length > 0) {
    const desc = tracks.slice(0, 10).map((t, i) => `${i+1}. ${t.title || 'Неизвестно'}`).join('\n');
    embed.setDescription(desc);
  }
  return embed;
}

function createPlaylistsEmbed(playlists) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Мои плейлисты')
    .setColor(0x673AB7)
    .setDescription(Object.keys(playlists).length > 0 ? 'Ваши плейлисты:' : 'Плейлистов нет');
  
  if (Object.keys(playlists).length > 0) {
    const names = Object.entries(playlists).map(([id, pl]) => `• ${pl.name} (${(pl.tracks || []).length} треков)`).join('\n');
    embed.addFields({ name: 'Плейлисты', value: names });
  }
  return embed;
}

function createPlaylistDetailEmbed(playlist) {
  const embed = new EmbedBuilder()
    .setTitle(`🎼 Плейлист — ${playlist.name || 'Без названия'}`)
    .setColor(0x8E44AD)
    .setDescription((playlist.tracks && playlist.tracks.length) ? `Треков: ${playlist.tracks.length}` : 'Плейлист пуст');
  if (playlist.tracks && playlist.tracks.length) {
    const lines = playlist.tracks.slice(0, 30).map((t, i) => `**${i+1}.** ${t.title || t.url || 'Неизвестно'}`);
    embed.addFields({ name: 'Треки', value: lines.join('\n') });
  }
  return embed;
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function createWeeklyTopEmbed(topTracks) {
  let description = '**Топ 10 песен за неделю на сервере:**\n\n';
  if (topTracks.length === 0) {
    description += 'Нет данных о прослушиваниях за эту неделю.';
  } else {
    topTracks.forEach((track, index) => {
      description += `**${index + 1}.** ${track.title} (${track.count} раз)\n`;
    });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🏆 Еженедельный хит-лист')
    .setColor(0xFFD700)
    .setDescription(description)
    .setFooter({ text: 'Обновляется каждую неделю' });
  
  return embed;
}

function createMusicLogsEmbed(logs) {
  let description = '**История прослушиваний:**\n\n';
  if (logs.length === 0) {
    description += 'Нет записей о прослушиваниях.';
  } else {
    logs.slice(0, 20).forEach(log => {
      description += `📻 ${log.formattedTime} - **${log.trackTitle}** (${log.voiceChannel})\n`;
    });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('📻 Логи музыки')
    .setColor(0x00BCD4)
    .setDescription(description)
    .setFooter({ text: `Всего записей: ${logs.length}` });
  
  return embed;
}

module.exports = {
  createMusicMenuEmbed,
  createRadioListEmbed,
  createNowPlayingEmbed,
  createPlayerControlsEmbed,
  createNowPlayingWithProgressEmbed,
  createHistoryEmbed,
  createFavoritesEmbed,
  createPlaylistsEmbed,
  createPlaylistDetailEmbed,
  formatTime,
  createWeeklyTopEmbed,
  createMusicLogsEmbed
};
