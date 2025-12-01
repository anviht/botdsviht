const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('🎭 [АДМИН] Управление ролями')
    .addSubcommand(sub => sub
      .setName('grant')
      .setDescription('Выдать роль пользователю')
      .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('Роль').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('Забрать роль у пользователя')
      .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('Роль').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Список всех ролей сервера'))
    .addSubcommand(sub => sub
      .setName('hierarchy')
      .setDescription('Просмотреть иерархию ролей')),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const sub = interaction.options.getSubcommand();

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    if (sub === 'grant') {
      const targetUser = interaction.options.getUser('user');
      const roleToGrant = interaction.options.getRole('role');

      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);

        if (targetMember.roles.cache.has(roleToGrant.id)) {
          return await interaction.reply({ content: `❌ У ${targetUser.username} уже есть роль ${roleToGrant.name}.`, ephemeral: true });
        }

        await targetMember.roles.add(roleToGrant);

        const embed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('🎭 Роль выдана')
          .addFields(
            { name: 'Пользователь', value: targetUser.username, inline: true },
            { name: 'Роль', value: roleToGrant.name, inline: true },
            { name: 'Админ', value: interaction.user.username, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (err) {
        return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'revoke') {
      const targetUser = interaction.options.getUser('user');
      const roleToRevoke = interaction.options.getRole('role');

      try {
        const targetMember = await interaction.guild.members.fetch(targetUser.id);

        if (!targetMember.roles.cache.has(roleToRevoke.id)) {
          return await interaction.reply({ content: `❌ У ${targetUser.username} нет роли ${roleToRevoke.name}.`, ephemeral: true });
        }

        await targetMember.roles.remove(roleToRevoke);

        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('🎭 Роль отобрана')
          .addFields(
            { name: 'Пользователь', value: targetUser.username, inline: true },
            { name: 'Роль', value: roleToRevoke.name, inline: true },
            { name: 'Админ', value: interaction.user.username, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (err) {
        return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'list') {
      const roles = interaction.guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .slice(0, 25);

      if (roles.size === 0) {
        return await interaction.reply({ content: '❌ На сервере нет ролей.', ephemeral: true });
      }

      const lines = roles.map(r => `${r.toString()} • ${r.members.size} членов • Позиция: ${r.position}`).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#9C27B0')
        .setTitle('🎭 Роли сервера')
        .setDescription(lines)
        .setFooter({ text: `Всего ролей: ${interaction.guild.roles.cache.size}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'hierarchy') {
      const roles = interaction.guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .slice(0, 20);

      const lines = roles
        .map((r, i) => `${i + 1}. ${r.toString()} (Позиция: ${r.position})`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('🎭 Иерархия ролей')
        .setDescription(lines || 'Нет ролей')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
