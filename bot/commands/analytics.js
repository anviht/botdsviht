const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('📊 [АДМИН] Просмотреть статистику сервера')
    .addStringOption(opt => opt
      .setName('type')
      .setDescription('Тип статистики')
      .setRequired(true)
      .addChoices(
        { name: '🎮 Игры', value: 'games' },
        { name: '⭐ Топ репутация', value: 'reputation' },
        { name: '💰 Топ баланс', value: 'balance' },
        { name: '🔥 Активные игроки', value: 'active' },
        { name: '📈 Статистика команд', value: 'commands' }
      )),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const type = interaction.options.getString('type');
    const gameStats = db.get('gameStats') || {};
    const balances = db.get('balances') || {};
    const commandLogs = db.get('commandLogs') || [];

    let embed;

    if (type === 'games') {
      let totalGames = 0;
      let totalWins = 0;
      for (const stats of Object.values(gameStats)) {
        totalGames += (stats.wins || 0) + (stats.losses || 0);
        totalWins += stats.wins || 0;
      }
      embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('🎮 Статистика игр')
        .addFields(
          { name: 'Всего сыграно игр', value: `**${totalGames}**`, inline: true },
          { name: 'Побед', value: `**${totalWins}**`, inline: true },
          { name: 'Активных игроков', value: `**${Object.keys(gameStats).length}**`, inline: true }
        );
    }

    if (type === 'reputation') {
      const sorted = Object.entries(gameStats)
        .map(([id, stats]) => ({ id, rep: stats.totalRep || 0 }))
        .sort((a, b) => b.rep - a.rep)
        .slice(0, 10);
      
      const lines = sorted.map((entry, i) => `${i + 1}. <@${entry.id}> - **${entry.rep}** ⭐`).join('\n');
      embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('⭐ Топ репутация')
        .setDescription(lines || 'Данных нет');
    }

    if (type === 'balance') {
      const sorted = Object.entries(balances)
        .map(([id, amount]) => ({ id, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10);
      
      const lines = sorted.map((entry, i) => `${i + 1}. <@${entry.id}> - **${entry.amount}** 🪙`).join('\n');
      embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('💰 Топ баланс')
        .setDescription(lines || 'Данных нет');
    }

    if (type === 'active') {
      const sorted = Object.entries(gameStats)
        .map(([id, stats]) => ({ id, total: (stats.wins || 0) + (stats.losses || 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      const lines = sorted.map((entry, i) => `${i + 1}. <@${entry.id}> - **${entry.total}** игр`).join('\n');
      embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('📊 Активные игроки')
        .setDescription(lines || 'Данных нет');
    }

    if (type === 'commands') {
      const cmdCount = {};
      commandLogs.forEach(log => {
        cmdCount[log.command] = (cmdCount[log.command] || 0) + 1;
      });
      
      const sorted = Object.entries(cmdCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      const lines = sorted.map(([cmd, count], i) => `${i + 1}. **/${cmd}** - ${count} вызовов`).join('\n');
      embed = new EmbedBuilder()
        .setColor('#9C27B0')
        .setTitle('📈 Статистика команд')
        .setDescription(lines || 'Данных нет');
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
