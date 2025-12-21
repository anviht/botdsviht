const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('мут')
    .setDescription('🔇 [АДМИН] Замутить пользователя')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addIntegerOption(opt => opt.setName('duration').setDescription('Длительность в минутах').setMinValue(1).setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Причина').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1446798710511243354'; // Канал логов модерации
    const MUTE_ROLE_ID = '1445152678706679939'; // Preset mute role

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

      // Get the mute role (must exist in guild)
      const mutedRole = interaction.guild.roles.cache.get(MUTE_ROLE_ID);
      if (!mutedRole) {
        return await interaction.editReply({ content: `❌ Роль мута (ID: ${MUTE_ROLE_ID}) не найдена на сервере. Попросите админа создать её.`, ephemeral: true });
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

      // Fetch all current roles of the user
      const currentRoles = targetMember.roles.cache.filter(r => r.id !== interaction.guild.id && r.id !== MUTE_ROLE_ID);
      const currentRoleIds = currentRoles.map(r => r.id);

      // If user already has mute role, just update the timeout
      if (targetMember.roles.cache.has(MUTE_ROLE_ID)) {
        // User already muted, just update DB entry with new expiry
        const mutes = db.get('mutes') || {};
        if (mutes[targetId]) {
          mutes[targetId].unmuteTime = new Date(Date.now() + duration * 60000).toISOString();
          mutes[targetId].adminId = adminId;
          mutes[targetId].reason = reason;
          mutes[targetId].muteTime = new Date().toISOString();
          await db.set('mutes', mutes);
        }
        const embed = new EmbedBuilder()
          .setColor('#808080')
          .setTitle('🔇 Мут пользователя обновлен')
          .addFields(
            { name: 'Пользователь', value: targetUser.username, inline: true },
            { name: 'Новая длительность', value: `${duration} минут`, inline: true },
            { name: 'Причина', value: reason, inline: false },
            { name: 'Админ', value: interaction.user.username, inline: true }
          )
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();
        return await interaction.editReply({ embeds: [embed] });
      }

      // Remove all current roles (except @everyone and mute role)
      if (currentRoleIds.length > 0) {
        try {
          await targetMember.roles.remove(currentRoleIds);
        } catch (e) {
          console.warn('Failed to remove some roles during mute:', e.message);
        }
      }

      // Add mute role
      try {
        await targetMember.roles.add(MUTE_ROLE_ID);
      } catch (e) {
        return await interaction.editReply({ content: `❌ Ошибка: не удалось добавить роль мута. ${e.message}`, ephemeral: true });
      }

      // Disconnect from voice channel if in one
      try {
        if (targetMember.voice && targetMember.voice.channel) {
          await targetMember.voice.setChannel(null).catch(() => {});
        }
      } catch (err) {
        // Ignore voice disconnect errors
      }

      // Save to DB (including removed roles for restoration)
      const mutes = db.get('mutes') || {};
      mutes[targetId] = {
        guildId: interaction.guild.id,
        adminId,
        reason,
        muteTime: new Date().toISOString(),
        unmuteTime: new Date(Date.now() + duration * 60000).toISOString(),
        removedRoles: currentRoleIds
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

      // Automatically unmute after duration
      const unmuteTimer = setTimeout(async () => {
        try {
          const stored = (await db.get('mutes')) || {};
          const entry = stored[targetId];
          if (!entry) return;

          const updatedMember = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!updatedMember) return;

          // Remove mute role
          if (updatedMember.roles.cache.has(MUTE_ROLE_ID)) {
            try { await updatedMember.roles.remove(MUTE_ROLE_ID); } catch (e) {
              console.warn('Failed to remove mute role during unmute:', e.message);
            }
          }

          // Restore previously removed roles
          if (entry.removedRoles && entry.removedRoles.length > 0) {
            const toRestore = entry.removedRoles.filter(id => interaction.guild.roles.cache.has(id));
            if (toRestore.length > 0) {
              try { await updatedMember.roles.add(toRestore); } catch (e) {
                console.warn('Failed to restore roles after unmute:', e.message);
              }
            }
          }

          // Remove from mutes DB
          delete stored[targetId];
          await db.set('mutes', stored);

          // Notify user
          try {
            const unmuteEmbed = new EmbedBuilder()
              .setColor('#2ECC71')
              .setTitle('🔊 Вы размучены')
              .setDescription(`Вы размучены на сервере **${interaction.guild.name}**`)
              .setTimestamp();
            await targetUser.send({ embeds: [unmuteEmbed] });
          } catch (e) {
            // DM failed, ignore
          }

          // Log to channel
          try {
            const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
            if (logChannel) {
              const logEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🔊 Пользователь размучен (автоматически)')
                .addFields(
                  { name: 'Пользователь', value: targetUser.username, inline: true },
                  { name: 'Причина мута была', value: reason, inline: false }
                )
                .setTimestamp();
              await logChannel.send({ embeds: [logEmbed] });
            }
          } catch (e) {
            // Log channel fetch failed
          }
        } catch (err) {
          console.error('Unmute timer error:', err.message);
        }
      }, duration * 60000);

      // Store timer ID for cleanup on bot restart (optional, for graceful shutdown)
      global.muteTimers = global.muteTimers || {};
      global.muteTimers[targetId] = unmuteTimer;

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }
};
