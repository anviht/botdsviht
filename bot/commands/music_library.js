const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const musicPlayer = require('../music/player2');
const { createHistoryEmbed, createFavoritesEmbed, createPlaylistsEmbed, createWeeklyTopEmbed, createMusicLogsEmbed } = require('../music-interface/musicEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music_library')
    .setDescription('Управление музыкальной библиотекой (история, избранное, плейлисты)')
    .addSubcommand(sub => sub.setName('history').setDescription('Показать историю воспроизведения'))
    .addSubcommand(sub => sub.setName('favorites').setDescription('Управление избранным'))
    .addSubcommand(sub => sub.setName('playlists').setDescription('Управление плейлистами'))
    .addSubcommand(sub => sub.setName('weekly_top').setDescription('Топ 10 песен за неделю'))
    .addSubcommand(sub => sub.setName('music_logs').setDescription('Логи прослушиваний на сервере')),

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
        const favorites = await musicPlayer.getFavorites(guildId, userId);
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
        const playlists = await musicPlayer.getPlaylists(guildId, userId);
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
    } else if (subcommand === 'weekly_top') {
      try {
        const topTracks = await musicPlayer.getWeeklyTopTracks(guildId, 10);
        const embed = createWeeklyTopEmbed(topTracks);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (e) {
        console.error('music_library weekly_top error', e);
        await interaction.reply({ content: '❌ Ошибка при получении топа.', ephemeral: true });
      }
    } else if (subcommand === 'music_logs') {
      try {
        const logs = await musicPlayer.getMusicLogs(guildId, 50);
        const embed = createMusicLogsEmbed(logs);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (e) {
        console.error('music_library music_logs error', e);
        await interaction.reply({ content: '❌ Ошибка при получении логов.', ephemeral: true });
      }
    }
  }
};
