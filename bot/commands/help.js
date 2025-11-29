const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Список доступных команд Viht (кратко и красиво)'),

  async execute(interaction) {
    const client = interaction.client;
    const allCmds = Array.from(client.commands.values());
    
    const publicCmds = allCmds.filter(c => !c.adminOnly);
    const adminCmds = allCmds.filter(c => c.adminOnly);
    
    const publicFields = publicCmds.map(cmd => ({
      name: `🔹 /${cmd.data.name}`,
      value: cmd.data.description || 'Нет описания',
      inline: false
    }));

    const adminFields = adminCmds.map(cmd => ({
      name: `🔐 /${cmd.data.name}`,
      value: cmd.data.description || 'Нет описания',
      inline: false
    }));

    const embed = new EmbedBuilder()
      .setTitle('📚 **Справка по командам Viht**')
      .setColor(0x3498db)
      .setDescription('Ниже — доступные команды для вас.')
      .setThumbnail(client.user.displayAvatarURL());

    if (publicFields.length > 0) {
      embed.addFields(
        { name: '📋 **Публичные команды:**', value: '\u200B' },
        ...publicFields
      );
    }

    if (adminCmds.length > 0 && adminFields.length > 0) {
      embed.addFields(
        { name: '\u200B', value: '\u200B' },
        { name: '🔐 **Команды администратора:**', value: '\u200B' },
        ...adminFields
      );
    }

    embed.setFooter({ text: 'Viht AI & VPN Bot | Версия 1.0' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
