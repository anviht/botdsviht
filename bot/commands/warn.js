const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('⚠️ [АДМИН] Выдать предупреждение пользователю')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(true)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1445119290444480684';

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const targetId = targetUser.id;
    const adminId = interaction.user.id;

    if (targetId === adminId) {
      return await interaction.reply({ content: '❌ Вы не можете выдать варн самому себе.', ephemeral: true });
    }

    // Сохранить варн в БД
    const warnings = db.get('warnings') || {};
    if (!warnings[targetId]) warnings[targetId] = [];
    warnings[targetId].push({
      adminId,
      reason,
      timestamp: new Date().toISOString(),
      active: true
    });
    await db.set('warnings', warnings);

    const warnCount = warnings[targetId].length;

    const embed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle('⚠️ Выдано предупреждение')
      .addFields(
        { name: 'Пользователь', value: targetUser.username, inline: true },
        { name: 'Причина', value: reason, inline: true },
        { name: 'Всего варнов', value: `**${warnCount}**`, inline: true },
        { name: 'Админ', value: interaction.user.username, inline: true }
      )
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Логирование в канал
    try {
      const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send({ embeds: [embed] });
      }
    } catch (err) {
      // Канал не найден
    }

    // Уведомить пользователя
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('⚠️ Вы получили предупреждение')
        .addFields(
          { name: 'Сервер', value: interaction.guild.name, inline: false },
          { name: 'Причина', value: reason, inline: false },
          { name: 'Ваше количество варнов', value: `**${warnCount}**`, inline: true }
        )
        .setTimestamp();
      await targetUser.send({ embeds: [dmEmbed] });
    } catch (err) {
      // DM не отправляется
    }
  }
};
