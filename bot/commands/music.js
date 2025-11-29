const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createMusicMenuEmbed } = require('../music-interface/musicEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('🎵 Открыть панель управления музыкой'),

  async execute(interaction) {
    try {
      const embed = createMusicMenuEmbed();
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_radio').setLabel('📻 Радио').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_own').setLabel('🎵 Своя музыка').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_link').setLabel('🔗 Ссылка').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } catch (e) {
      console.error('Music command error:', e);
      await interaction.reply({ content: '❌ Ошибка при открытии панели музыки', ephemeral: true });
    }
  }
};
