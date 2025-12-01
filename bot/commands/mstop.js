const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mstop')
    .setDescription('⏹️ Просмотр занятости музыкального плеера и его отключение (только администраторы)'),

  async execute(interaction) {
    const config = require('../config');
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(()=>null) : null);
    if (!member || !member.roles || !member.roles.cache || !config.adminRoles || !config.adminRoles.some(rid => member.roles.cache.has(rid))) {
      return await interaction.reply({ content: 'У вас нет права использовать эту команду.', ephemeral: true });
    }

    await db.ensureReady();
    const key = `musicControl_${interaction.guild.id}`;
    const rec = db.get(key) || {};
    const owner = rec.owner || null;

    if (!owner) {
      const embed = new EmbedBuilder().setTitle('Плеер свободен').setDescription('В данный момент никому не занят.');
      return await interaction.reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder().setTitle('Плеер занят').setDescription(`Плеер сейчас занят пользователем <@${owner}>`).setColor(0xE74C3C);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`music_admin_release_${interaction.guild.id}_${owner}`).setLabel(`Отключить ${owner}`).setStyle(ButtonStyle.Danger)
    );

    // Show publicly in channel so others can see who occupied it — only admins can press the button
    await interaction.reply({ embeds: [embed], components: [row] });
  }
};
