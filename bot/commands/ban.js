const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('🚫 [АДМИН] Забанить пользователя')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(false))
    .addBooleanOption(opt => opt.setName('delete_messages').setDescription('Удалить сообщения за 7 дней?').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1445119290444480684';

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Не указана';
    const deleteMessages = interaction.options.getBoolean('delete_messages') || false;
    const targetId = targetUser.id;
    const adminId = interaction.user.id;

    if (targetId === adminId) {
      return await interaction.reply({ content: '❌ Вы не можете забанить самого себя.', ephemeral: true });
    }

    try {
      // Забанить пользователя
      await interaction.guild.members.ban(targetId, {
        reason: reason,
        deleteMessageDays: deleteMessages ? 7 : 0
      });

      // Сохранить в БД
      const bans = db.get('bans') || {};
      bans[targetId] = {
        adminId,
        reason,
        timestamp: new Date().toISOString(),
        deleteMessages
      };
      await db.set('bans', bans);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🚫 Пользователь забанен')
        .addFields(
          { name: 'Пользователь', value: targetUser.username, inline: true },
          { name: 'ID', value: targetId, inline: true },
          { name: 'Причина', value: reason, inline: false },
          { name: 'Админ', value: interaction.user.username, inline: true },
          { name: 'Удалены сообщения', value: deleteMessages ? '✅ Да' : '❌ Нет', inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Логирование
      try {
        const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send({ embeds: [embed] });
        }
      } catch (err) {
        // Канал не найден
      }

      // Попытка уведомить пользователя
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🚫 Вы забанены')
          .addFields(
            { name: 'Сервер', value: interaction.guild.name, inline: false },
            { name: 'Причина', value: reason, inline: false },
            { name: 'Дата', value: new Date().toLocaleString(), inline: false }
          )
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] });
      } catch (err) {
        // DM не отправляется или пользователь уже забанен
      }

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка при бане: ${err.message}`, ephemeral: true });
    }
  }
};
