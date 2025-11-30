const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

function getVersion() {
  try {
    const vf = path.join(process.cwd(), 'VERSION');
    if (fs.existsSync(vf)) {
      const v = fs.readFileSync(vf, 'utf8').trim();
      return v ? `v-${v}` : 'v-unknown';
    }
  } catch (e) { /* ignore */ }
  return 'v-unknown';
}

function createMainControlPanelEmbed() {
  const version = getVersion();
  const embed = new EmbedBuilder()
    .setTitle('🎛️ Управление ботом Viht')
    .setColor(0x2C3E50)
    .setDescription('Выберите раздел:')
    .setThumbnail('https://cdn-icons-png.flaticon.com/512/3556/3556097.png')
    .setFooter({ text: `Версия: ${version}` });
  return embed;
}

function createPersonalCabinetEmbed(member) {
  const embed = new EmbedBuilder()
    .setTitle('👤 Личный кабинет')
    .setColor(0x3498DB)
    .setDescription(`**Пользователь:** ${member.user.username}`)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'ID', value: member.user.id, inline: true },
      { name: 'Присоединился', value: member.joinedAt ? member.joinedAt.toLocaleDateString('ru-RU') : 'N/A', inline: true },
      { name: 'Статус', value: '✅ Online', inline: true }
    );
  return embed;
}

function getMainControlRow() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cabinet_main').setLabel('👤 Личный кабинет').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('music_menu').setLabel('🎵 Музыка').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('info_btn').setLabel('ℹ️ Информация').setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
  return row;
}

function getCabinetControlRow() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('main_menu').setLabel('← Главное меню').setStyle(ButtonStyle.Danger)
  );
  return row;
}

module.exports = {
  createMainControlPanelEmbed,
  createPersonalCabinetEmbed,
  getMainControlRow,
  getCabinetControlRow
};
