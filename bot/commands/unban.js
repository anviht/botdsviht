const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('✅ [АДМИН] Разбанить пользователя')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь (если нельзя выбрать, используйте ID через текст)').setRequired(true)),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const LOG_CHANNEL_ID = '1445119290444480684';

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) return await interaction.reply({ content: '❌ Только администраторы.', ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const targetId = targetUser.id;

    try {
      await interaction.guild.bans.remove(targetId);

      const bans = db.get('bans') || {};
      if (bans[targetId]) delete bans[targetId];
      await db.set('bans', bans);

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Пользователь разбанен')
        .setDescription(`<@${targetId}> разбанен`)
        .addFields({ name: 'Админ', value: interaction.user.username, inline: true })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      try { const ch = await interaction.guild.channels.fetch(LOG_CHANNEL_ID); if (ch) ch.send({ embeds: [embed] }); } catch (e) {}

    } catch (err) {
      return await interaction.reply({ content: `❌ Ошибка при разбане: ${err.message}`, ephemeral: true });
    }
  }
};
