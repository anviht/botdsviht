const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mstop')
    .setDescription('⏹️ Просмотр занятости музыкального плеера и его отключение (только администраторы)'),

  async execute(interaction) {
    const config = require('../config');
    const MSTOP_ROLE_ID = '1436485697392607303'; // Роль которая может использовать /mstop
    
    const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(()=>null) : null);
    if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(MSTOP_ROLE_ID)) {
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'У вас нет права использовать эту команду. Требуется специальная роль.', ephemeral: true });
        else await interaction.reply({ content: 'У вас нет права использовать эту команду. Требуется специальная роль.', ephemeral: true });
      } catch (e) {
        try { await interaction.followUp({ content: 'У вас нет права использовать эту команду.', ephemeral: true }); } catch (ignore) {}
      }
      return;
    }

    await db.ensureReady();
    const key = `musicControl_${interaction.guild.id}`;
    const rec = db.get(key) || {};
    const owner = rec.owner || null;

    if (!owner) {
      const embed = new EmbedBuilder().setTitle('Плеер свободен').setDescription('В данный момент никому не занят.');
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [embed] });
        else await interaction.reply({ embeds: [embed] });
      } catch (e) { try { await interaction.followUp({ embeds: [embed] }); } catch (ignore) {} }
      return;
    }

    const embed = new EmbedBuilder().setTitle('Плеер занят').setDescription(`Плеер сейчас занят пользователем <@${owner}>`).setColor(0xE74C3C);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`music_admin_release_${interaction.guild.id}_${owner}`).setLabel(`Отключить ${owner}`).setStyle(ButtonStyle.Danger)
    );

    // Show publicly in channel so others can see who occupied it — only admins can press the button
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [embed], components: [row] });
      else await interaction.reply({ embeds: [embed], components: [row] });
    } catch (e) {
      try { await interaction.followUp({ embeds: [embed], components: [row] }); } catch (ignore) {}
    }
  }
};
