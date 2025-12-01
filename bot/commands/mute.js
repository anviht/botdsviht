const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('🔇 [АДМИН] Замутить пользователя')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addIntegerOption(opt => opt.setName('duration').setDescription('Длительность в минутах').setMinValue(1).setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1445119290444480684';

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || 'Не указана';
    const targetId = targetUser.id;
    const adminId = interaction.user.id;

    if (targetId === adminId) {
      return await interaction.reply({ content: '❌ Вы не можете замутить самого себя.', ephemeral: true });
    }

    try {
      const targetMember = await interaction.guild.members.fetch(targetId);

      // Создать или найти muted роль
      let mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
      if (!mutedRole) {
        mutedRole = await interaction.guild.roles.create({
          name: 'Muted',
          color: '#808080',
          reason: 'Роль для замучиванных пользователей'
        });

        // Установить permissions на каналы
        const channels = await interaction.guild.channels.fetch();
        for (const [, channel] of channels) {
          if (channel.isTextBased() || channel.isVoiceBased()) {
            try {
              await channel.permissionOverwrites.edit(mutedRole, {
                SendMessages: false,
                Speak: false,
                AddReactions: false
              });
            } catch (err) {
              // Игнорировать ошибки permissions
            }
          }
        }
      }

      await targetMember.roles.add(mutedRole);

      // Сохранить в БД
      const mutes = db.get('mutes') || {};
      mutes[targetId] = {
        adminId,
        reason,
        muteTime: new Date().toISOString(),
        unmuteTime: new Date(Date.now() + duration * 60000).toISOString()
      };
      await db.set('mutes', mutes);

      const embed = new EmbedBuilder()
        .setColor('#808080')
        .setTitle('🔇 Пользователь замучен')
        .addFields(
          { name: 'Пользователь', value: targetUser.username, inline: true },
          { name: 'Длительность', value: `${duration} минут`, inline: true },
          { name: 'Причина', value: reason, inline: false },
          { name: 'Админ', value: interaction.user.username, inline: true }
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

      // Уведомить пользователя
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor('#808080')
          .setTitle('🔇 Вы замучены')
          .addFields(
            { name: 'Сервер', value: interaction.guild.name, inline: false },
            { name: 'Причина', value: reason, inline: false },
            { name: 'Длительность', value: `${duration} минут`, inline: true }
          )
          .setTimestamp();
        await targetUser.send({ embeds: [dmEmbed] });
      } catch (err) {
        // DM не отправляется
      }

      // Автоматически размутить через duration минут
      setTimeout(async () => {
        try {
          const updatedMember = await interaction.guild.members.fetch(targetId);
          const role = interaction.guild.roles.cache.find(r => r.name === 'Muted');
          if (role && updatedMember.roles.cache.has(role.id)) {
            await updatedMember.roles.remove(role);
            delete mutes[targetId];
            await db.set('mutes', mutes);
          }
        } catch (err) {
          // Игнорировать
        }
      }, duration * 60000);

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }
};
