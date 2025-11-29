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

module.exports = {
  createMusicMenuEmbed,
  createRadioListEmbed,
  createNowPlayingEmbed,
  createPlayerControlsEmbed
};
