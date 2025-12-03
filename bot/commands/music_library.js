const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const musicPlayer = require('../music/player2');
const { createHistoryEmbed, createFavoritesEmbed, createPlaylistsEmbed } = require('../music-interface/musicEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music_library')
    .setDescription('Управление музыкальной библиотекой (история, избранное, плейлисты)')
    .addSubcommand(sub => sub.setName('history').setDescription('Показать историю воспроизведения'))
    .addSubcommand(sub => sub.setName('favorites').setDescription('Управление избранным'))
    .addSubcommand(sub => sub.setName('playlists').setDescription('Управление плейлистами')),

  execute: async (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (subcommand === 'history') {
      try {
        const history = await musicPlayer.getHistory(guildId, userId);
        const embed = createHistoryEmbed(history);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (e) {
        console.error('music_library history error', e);
        await interaction.reply({ content: '❌ Ошибка при получении истории.', ephemeral: true });
      }
    } else if (subcommand === 'favorites') {
      try {
        const favorites = musicPlayer.getFavorites(guildId, userId);
        const embed = createFavoritesEmbed(favorites);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_lib_fav_add').setLabel('➕ Добавить текущий трек').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('music_lib_fav_clear').setLabel('🗑️ Очистить').setStyle(ButtonStyle.Danger)
        );
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        console.error('music_library favorites error', e);
        await interaction.reply({ content: '❌ Ошибка при получении избранного.', ephemeral: true });
      }
    } else if (subcommand === 'playlists') {
      try {
        const playlists = musicPlayer.getPlaylists(guildId, userId);
        const embed = createPlaylistsEmbed(playlists);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_lib_pl_new').setLabel('➕ Новый плейлист').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('music_lib_pl_clear').setLabel('🗑️ Удалить все').setStyle(ButtonStyle.Danger)
        );
        
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      } catch (e) {
        console.error('music_library playlists error', e);
        await interaction.reply({ content: '❌ Ошибка при получении плейлистов.', ephemeral: true });
      }
    }
  }
};
