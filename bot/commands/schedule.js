const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('📅 [АДМИН] Запланировать объявление')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Создать запланированное объявление')
      .addStringOption(opt => opt.setName('message').setDescription('Текст объявления').setRequired(true).setMaxLength(2000))
      .addIntegerOption(opt => opt.setName('hours').setDescription('Через сколько часов отправить (1-720)').setMinValue(1).setMaxValue(720).setRequired(true))
      .addChannelOption(opt => opt.setName('channel').setDescription('Канал для отправки').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Просмотреть все запланированные объявления')),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const sub = interaction.options.getSubcommand();

    const isAdmin = config.adminRoles.some(rid => interaction.member.roles.cache.has(rid));
    if (!isAdmin) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const scheduled = db.get('scheduled') || [];

    if (sub === 'create') {
      const message = interaction.options.getString('message');
      const hours = interaction.options.getInteger('hours');
      const channel = interaction.options.getChannel('channel');

      if (!channel.isTextBased()) {
        return await interaction.reply({ content: '❌ Это не текстовый канал.', ephemeral: true });
      }

      const scheduleId = Date.now().toString();
      const sendTime = new Date(Date.now() + hours * 3600000);

      scheduled.push({
        id: scheduleId,
        message,
        channelId: channel.id,
        sendTime: sendTime.toISOString(),
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        sent: false
      });

      await db.set('scheduled', scheduled);

      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('📅 Объявление запланировано')
        .addFields(
          { name: 'Канал', value: channel.toString(), inline: true },
          { name: 'Через', value: `${hours} часов`, inline: true },
          { name: 'Время отправки', value: sendTime.toLocaleString(), inline: false },
          { name: 'Сообщение', value: message, inline: false }
        )
        .setFooter({ text: `ID: ${scheduleId}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Запустить таймер
      setTimeout(async () => {
        try {
          const targetChannel = await interaction.guild.channels.fetch(channel.id);
          if (targetChannel && targetChannel.isTextBased()) {
            const annEmbed = new EmbedBuilder()
              .setColor('#2196F3')
              .setTitle('📢 Объявление')
              .setDescription(message)
              .setTimestamp();
            await targetChannel.send({ embeds: [annEmbed] });
          }

          // Отметить как отправленное
          const updatedScheduled = db.get('scheduled') || [];
          const idx = updatedScheduled.findIndex(s => s.id === scheduleId);
          if (idx !== -1) {
            updatedScheduled[idx].sent = true;
            await db.set('scheduled', updatedScheduled);
          }
        } catch (err) {
          // Ошибка при отправке
        }
      }, hours * 3600000);

      return;
    }

    if (sub === 'list') {
      if (scheduled.length === 0) {
        return await interaction.reply({ content: '📅 Нет запланированных объявлений.', ephemeral: true });
      }

      const lines = scheduled
        .filter(s => !s.sent)
        .map(s => {
          const sendTime = new Date(s.sendTime);
          return `**ID:** ${s.id}\n**Канал:** <#${s.channelId}>\n**Отправка:** ${sendTime.toLocaleString()}\n**Сообщение:** ${s.message.substring(0, 100)}...`;
        })
        .slice(0, 10)
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('📅 Запланированные объявления')
        .setDescription(lines || 'Нет активных объявлений');

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
