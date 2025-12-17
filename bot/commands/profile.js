const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');
const chatHistory = require('../ai/chatHistory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('👤 Просмотр вашего профиля со статистикой и репутацией'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    
    const tickets = db.get('tickets') || [];
    const myTickets = tickets.filter(t => t.creatorId === userId).length;
    const aiStats = db.get('stats') || { aiRequests: 0 };
    const myHistory = chatHistory.getHistory(userId) || [];

    // Музыкальная статистика
    const music = db.get('music') || {};
    const historyCount = (music.history && music.history[`${guildId}_${userId}`] && music.history[`${guildId}_${userId}`].length) || 0;
    const favCount = (music.favorites && music.favorites[`${guildId}_${userId}`] && music.favorites[`${guildId}_${userId}`].length) || 0;
    const playlistCount = (music.playlists && music.playlists[`${guildId}_${userId}`] && Object.keys(music.playlists[`${guildId}_${userId}`]).length) || 0;
    const achievements = musicPlayer.getAchievements(userId);
    const musicPlayed = (achievements['played_music'] && achievements['played_music'].count) || 0;

    // Get member info for roles and join date (best effort)
    let member = interaction.member;
    if ((!member || !member.joinedAt) && interaction.guild) {
      member = await interaction.guild.members.fetch(userId).catch(() => null);
    }

    const roles = (member && member.roles && member.roles.cache) ? member.roles.cache.filter(r => r.id !== interaction.guild?.id).map(r => r.name) : [];
    const joined = member && member.joinedAt ? `${member.joinedAt.toLocaleDateString()} ${member.joinedAt.toLocaleTimeString()}` : '—';

    // Simple reputation score: tickets*5 + aiMessages*1 + roles*2 + musicPlayed*0.5
    const reputation = (myTickets * 5) + (myHistory.length * 1) + (roles.length * 2) + Math.floor(musicPlayed * 0.5);

    const embed = new EmbedBuilder()
      .setTitle(`Профиль — ${interaction.user.username}`)
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 128 }))
      .setColor(0x5865F2)
      .addFields(
        { name: 'ID', value: String(userId), inline: true },
        { name: 'Вход на сервер', value: joined, inline: true },
        { name: 'Роли (кол-во)', value: String(roles.length || 0), inline: true },
        { name: '🎵 Песен прослушано', value: String(musicPlayed), inline: true },
        { name: '❤️ В избранном', value: String(favCount), inline: true },
        { name: '📋 Плейлистов', value: String(playlistCount), inline: true },
        { name: 'Тикетов создано', value: String(myTickets), inline: true },
        { name: 'Сообщений в истории ИИ', value: String(myHistory.length), inline: true },
        { name: 'Глобально AI запросов', value: String(aiStats.aiRequests || 0), inline: true },
        { name: 'Репутация', value: String(reputation), inline: true }
      )
      .setFooter({ text: 'Интерактивный профиль — данные видны только вам.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('profile_music_stats').setLabel('🎵 Музыка').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('profile_achievements').setLabel('🏆 Достижения').setStyle(ButtonStyle.Success)
    );

    // Additional explanation (ephemeral as separate message) about how to earn
    const how = `Как получать и зарабатывать очки репутации:\n` +
      `- Прослушивайте музыку (каждая песня = +0.5 очков)\n` +
      `- Создавайте тикеты (каждый тикет = +5 очков)\n` +
      `- Используйте AI (локальные сообщения = +1 очко за сообщение)\n` +
      `- Получайте роли сообщества (каждая роль = +2 очка)\n\n` +
      `Примечание: сообщения ИИ сохраняются локально в памяти бота по умолчанию.`;

    await interaction.reply({ embeds: [embed], ephemeral: true });
    await interaction.followUp({ content: how, ephemeral: true });
  }
};
