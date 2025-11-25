const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sms1win')
    .setDescription('Отправить приветственное сообщение в AI-канал (только для админов)'),

  adminOnly: true,

  async execute(interaction) {
    const ADMIN_ROLE = '1436485697392607303';
    try {
      const member = interaction.member;
      if (!member || !member.roles || !member.roles.cache || !member.roles.cache.has(ADMIN_ROLE)) {
        return await interaction.reply({ content: 'У вас нет прав для выполнения этой команды.', ephemeral: true });
      }

      const CHANNEL_ID = '1437189999882801173';
      const target = await interaction.client.channels.fetch(CHANNEL_ID).catch(() => null);
      if (!target || !target.send) {
        return await interaction.reply({ content: 'Целевой канал не найден.', ephemeral: true });
      }

      const welcome = `👋 Привет! Я **Viht** — бот-помощник проекта Viht VPN.

Я помогу вам с настройкой Viht VPN, дам подсказки и помогу с базовыми вопросами по конфигурации.

Если у вас остались вопросы, на которые бот не сможет ответить, пожалуйста, обращайтесь в канал помощи: https://discord.com/channels/1428051812103094282/1442575929044897792

Я рад помочь вам в настройке, а также могу помочь с кодингом и другими вопросами. 😊`;

      await target.send(welcome).catch(() => null);
      await interaction.reply({ content: 'Приветственное сообщение отправлено.', ephemeral: true });
    } catch (err) {
      console.error('sms1win error', err);
      try { await interaction.reply({ content: 'Ошибка при отправке сообщения.', ephemeral: true }); } catch (e) {}
    }
  }
};
