const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Список доступных команд Viht (кратко и красиво)'),

  async execute(interaction) {
    const client = interaction.client;
    
    // Fetch all slash commands from Discord
    let allCmds = [];
    try {
      const commands = await client.application.commands.fetch();
      allCmds = Array.from(commands.values());
    } catch (e) {
      console.warn('Failed to fetch commands:', e.message);
    }

    // Fallback: if no commands fetched, try from client cache
    if (allCmds.length === 0) {
      allCmds = Array.from(client.commands?.values() || []);
    }

    // Map to consistent format
    const cmdList = allCmds.map(cmd => ({
      name: cmd.name || cmd.data?.name,
      description: cmd.description || cmd.data?.description || 'Нет описания',
      adminOnly: cmd.adminOnly || false
    })).filter(c => c.name);

    const publicCmds = cmdList.filter(c => !c.adminOnly);
    const adminCmds = cmdList.filter(c => c.adminOnly);

    const publicFields = publicCmds.map(cmd => ({
      name: `🔹 /${cmd.name}`,
      value: cmd.description,
      inline: false
    }));

    const adminFields = adminCmds.map(cmd => ({
      name: `🔐 /${cmd.name}`,
      value: cmd.description,
      inline: false
    }));

    const embed = new EmbedBuilder()
      .setTitle('📚 **Справка по командам Viht**')
      .setColor(0x3498db)
      .setDescription('Ниже — все доступные команды.')
      .setThumbnail(client.user.displayAvatarURL());

    if (publicFields.length > 0) {
      embed.addFields(
        { name: '📋 **Публичные команды:**', value: '\u200B' },
        ...publicFields
      );
    }

    if (adminFields.length > 0) {
      embed.addFields(
        { name: '\u200B', value: '\u200B' },
        { name: '🔐 **Команды администратора:**', value: '\u200B' },
        ...adminFields
      );
    }

    if (publicFields.length === 0 && adminFields.length === 0) {
      embed.setDescription('❌ Не удалось загрузить список команд.');
    }

    embed.setFooter({ text: 'Viht AI & VPN Bot | Версия 1.0' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
