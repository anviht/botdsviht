const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('🔊 [АДМИН] Снять мут с пользователя')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1445119290444480684';

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) return await interaction.reply({ content: '❌ Только администраторы.', ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const targetId = targetUser.id;

    try {
      const member = await interaction.guild.members.fetch(targetId);
      const mutedRole = interaction.guild.roles.cache.find(r => r.name === 'Muted');
      if (!mutedRole || !member.roles.cache.has(mutedRole.id)) {
        return await interaction.reply({ content: 'ℹ️ Пользователь не замучен.', ephemeral: true });
      }

      await member.roles.remove(mutedRole);

      const mutes = db.get('mutes') || {};
      delete mutes[targetId];
      await db.set('mutes', mutes);

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('🔊 Мут снят')
        .setDescription(`🔓 Мут снят у <@${targetId}>`)
        .addFields({ name: 'Админ', value: interaction.user.username, inline: true })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      try { const ch = await interaction.guild.channels.fetch(LOG_CHANNEL_ID); if (ch) ch.send({ embeds: [embed] }); } catch (e) {}

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
    }
  }
};
