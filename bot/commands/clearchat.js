const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearchat')
    .setDescription('Удалить последние N сообщений в канале (только для роли админа)')
    .addIntegerOption(option => option.setName('count').setDescription('Сколько последних сообщений удалить').setRequired(true).setMinValue(1).setMaxValue(1000)),

  adminOnly: true,

  async execute(interaction) {
    const ADMIN_ROLE = '1436485697392607303';
    const count = interaction.options.getInteger('count');

    // Check role
    try {
      const member = interaction.member;
      if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(ADMIN_ROLE)) {
        return await interaction.reply({ content: 'У вас нет прав для выполнения этой команды.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        return await interaction.editReply('Эта команда может выполняться только в текстовом канале.');
      }

      let toDelete = count;
      let deleted = 0;
      let lastId = null;

      // iterate through channel history and delete messages until we've deleted `count`
      while (deleted < count) {
        const fetchLimit = Math.min(100, count - deleted);
        const options = { limit: fetchLimit };
        if (lastId) options.before = lastId;
        const fetched = await channel.messages.fetch(options).catch(() => null);
        if (!fetched || fetched.size === 0) break;

        // Order messages from newest to oldest
        const msgs = Array.from(fetched.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        lastId = msgs[msgs.length - 1].id;

        for (const msg of msgs) {
          if (deleted >= count) break;
          try {
            // skip pinned messages
            if (msg.pinned) continue;
            await msg.delete().catch(() => null);
            deleted += 1;
            // small delay to avoid hitting rate limits
            await new Promise(r => setTimeout(r, 120));
          } catch (err) {
            // ignore individual delete errors
          }
        }

        // if we fetched less than requested and didn't progress, break to avoid infinite loop
        if (fetched.size < fetchLimit && msgs.length === 0) break;
      }

      await interaction.editReply(`Готово — удалено сообщений: ${deleted}`);
    } catch (err) {
      console.error('clearchat error:', err);
      try { await interaction.reply({ content: 'Ошибка при удалении сообщений.', ephemeral: true }); } catch (e) {}
    }
  }
};
