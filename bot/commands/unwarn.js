const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('✅ [АДМИН] Снять варны у пользователя (по индексу или все)')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addIntegerOption(opt => opt.setName('index').setDescription('Номер варна (1 - самый первый). Оставьте пустым, чтобы удалить все').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1446798710511243354'; // Канал логов модерации

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) return await interaction.reply({ content: '❌ Только администраторы.', ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const idx = interaction.options.getInteger('index');
    const targetId = targetUser.id;

    const userViolations = db.get('userViolations') || {};
    if (!userViolations[targetId] || userViolations[targetId].length === 0) {
      return await interaction.reply({ content: 'ℹ️ У пользователя нет варнов.', ephemeral: true });
    }

    if (idx) {
      const i = idx - 1;
      if (i < 0 || i >= userViolations[targetId].length) return await interaction.reply({ content: '❌ Неверный индекс варна.', ephemeral: true });
      const removed = userViolations[targetId].splice(i, 1)[0];
      await db.set('userViolations', userViolations);

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Варн удалён')
        .setDescription(`Снят варн #${idx} у <@${targetId}>`)
        .addFields({ name: 'Причина', value: removed.reason || '—', inline: false }, { name: 'Админ', value: interaction.user.username, inline: true })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      try { const ch = await interaction.guild.channels.fetch(LOG_CHANNEL_ID); if (ch) ch.send({ embeds: [embed] }); } catch (e) {}
      return;
    }

    // Удалить все
    delete userViolations[targetId];
    await db.set('userViolations', userViolations);

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Все варны сняты')
      .setDescription(`Сняты все варны у <@${targetId}>`)
      .addFields({ name: 'Админ', value: interaction.user.username, inline: true })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    try { const ch = await interaction.guild.channels.fetch(LOG_CHANNEL_ID); if (ch) ch.send({ embeds: [embed] }); } catch (e) {}
  }
};
