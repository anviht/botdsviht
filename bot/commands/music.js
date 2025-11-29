const { SlashCommandBuilder } = require('discord.js');
const { createMusicMainPanel } = require('../radio/musicHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('🎵 Открыть панель управления музыкой'),

  async execute(interaction) {
    try {
      await interaction.reply(createMusicMainPanel());
    } catch (e) {
      console.error('Music command error:', e);
      await interaction.reply({ content: '❌ Ошибка при открытии панели музыки', ephemeral: true });
    }
  }
};
