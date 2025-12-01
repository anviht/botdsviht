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
      // Defer reply early to avoid interaction timeout during long operations
      await interaction.deferReply();

      const targetMember = await interaction.guild.members.fetch(targetId);
      const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id);

      // Создать или найти muted роль
      let mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
      if (!mutedRole) {
        mutedRole = await interaction.guild.roles.create({
          name: 'Muted',
          color: '#808080',
          reason: 'Роль для замучиванных пользователей'
        });
      }

      // Установить/обновить permissions на все каналы: запретить отправку сообщений и реакции в текстовых, и говорить/подключаться в голосовых
      try {
        const channels = await interaction.guild.channels.fetch();
        for (const [, channel] of channels) {
          try {
            if (channel.isTextBased && channel.isTextBased()) {
              await channel.permissionOverwrites.edit(mutedRole, {
                SendMessages: false,
                AddReactions: false
              });
            }
            if (channel.isVoiceBased && channel.isVoiceBased()) {
              await channel.permissionOverwrites.edit(mutedRole, {
                Speak: false,
                Connect: false
              });
            }
          } catch (err) {
            // Игнорировать ошибки permissions для отдельных каналов
          }
        }
      } catch (err) {
        // Игнорировать
      }

      // Remove existing roles that can allow sending messages — store them to restore later
      const botHighestPos = botMember.roles.highest ? botMember.roles.highest.position : 0;
      const removable = targetMember.roles.cache.filter(r => {
        if (r.id === interaction.guild.id) return false; // @everyone
        if (r.id === mutedRole.id) return false;
        if (r.managed) return false; // don't touch integrations
        if (!r.editable) return false; // bot cannot remove
        // avoid removing roles higher or equal to bot
        if (r.position >= botHighestPos) return false;
        // avoid removing configured adminRoles
        if (config.adminRoles && config.adminRoles.includes(r.id)) return false;
        return true;
      });

      const removedRoleIds = removable.map(r => r.id);
      if (removedRoleIds.length > 0) {
        try { await targetMember.roles.remove(removedRoleIds); } catch (e) { /* ignore */ }
      }

      await targetMember.roles.add(mutedRole);

      // Отключить из голосового канала, если пользователь был в нём (если у бота есть право перемещать участников)
      try {
        if (targetMember.voice && targetMember.voice.channel) {
          // try to move to null (disconnect)
          await targetMember.voice.setChannel(null).catch(() => {});
        }
      } catch (err) {
        // Игнорировать ошибки при отключении
      }

      // Отключить из голосового канала, если пользователь был в нём
      try {
        if (targetMember.voice && targetMember.voice.channel) {
          await targetMember.voice.setChannel(null).catch(() => {});
        }
      } catch (err) {
        // Игнорировать ошибки при отключении
      }

      // Сохранить в БД (включая снятые роли для восстановления)
      const mutes = db.get('mutes') || {};
      mutes[targetId] = {
        adminId,
        reason,
        muteTime: new Date().toISOString(),
        unmuteTime: new Date(Date.now() + duration * 60000).toISOString(),
        removedRoles: removedRoleIds
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

      await interaction.editReply({ embeds: [embed] });

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
          const stored = (await db.get('mutes')) || {};
          const entry = stored[targetId];
          if (!entry) return;
          const updatedMember = await interaction.guild.members.fetch(targetId).catch(() => null);
          const role = interaction.guild.roles.cache.find(r => r.name === 'Muted');
          if (updatedMember && role && updatedMember.roles.cache.has(role.id)) {
            try { await updatedMember.roles.remove(role); } catch (e) {}
            if (entry.removedRoles && entry.removedRoles.length > 0) {
              const toRestore = entry.removedRoles.filter(id => interaction.guild.roles.cache.has(id));
              if (toRestore.length > 0) {
                try { await updatedMember.roles.add(toRestore); } catch (e) {}
              }
            }
          }
          delete stored[targetId];
          await db.set('mutes', stored);
        } catch (err) {
          // Игнорировать
        }
      }, duration * 60000);

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }
};
