const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('нарушения')
    .setDescription('📊 Информация о пользователе (нарушения, мут, варны)')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(false)),

  async execute(interaction) {
    await db.ensureReady();
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    // Получаем данные пользователя
    const userViolations = db.get('userViolations') || {}; // ручные варны/нарушения
    const userMutes = db.get('userMutes') || {};
    const userBans = db.get('userBans') || {};
    const badwordViolations = db.get('badwordViolations') || {}; // авто-нарушения за мат

    const violations = userViolations[userId] || [];
    const muteRecord = userMutes[userId] || {};
    const banRecord = userBans[userId] || null;
    const autoBadwords = badwordViolations[userId] || [];

    // Подсчитываем активные варны (в последних 30 дней) — только ручные варны
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const activeWarnings = violations.filter(v => new Date(v.timestamp).getTime() > thirtyDaysAgo).length;
    // Активные автоматические нарушения за мат (30 дней)
    const activeAutoBadwords = autoBadwords.filter(v => new Date(v.timestamp).getTime() > thirtyDaysAgo).length;

    // Создаём embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 Информация о ${targetUser.username}`)
      .setColor(activeWarnings >= 3 ? 0xFF6B6B : activeWarnings >= 1 ? 0xFFD700 : 0x2ECC71)
      .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '👤 ID пользователя', value: userId, inline: true },
        { name: '📅 Аккаунт создан', value: targetUser.createdAt.toLocaleDateString('ru-RU'), inline: true },
        { name: '⚠️ Активные варны (30 дней)', value: `${activeWarnings} / 3`, inline: true },
        { name: '📋 Всего ручных нарушений', value: violations.length.toString(), inline: true },
        { name: '🤖 Авто-нарушения (мат, 30д)', value: `${activeAutoBadwords} (всего ${autoBadwords.length})`, inline: true },
        { name: '🔇 Текущий мут', value: muteRecord.active ? `${muteRecord.duration} минут` : 'Нет', inline: true },
        { name: '⛔ Статус бана', value: banRecord ? `Забанен: ${banRecord.reason}` : 'Не забанен', inline: true }
      );

    // Если есть ручные нарушения - показываем последние
    if (violations.length > 0) {
      const lastViolations = violations.slice(-5).reverse();
      const violationText = lastViolations.map((v, i) => 
        `${i+1}. ${v.type} (${v.reason}) - ${new Date(v.timestamp).toLocaleDateString('ru-RU')}`
      ).join('\n');
      embed.addFields({ name: '📝 Последние ручные нарушения', value: violationText || 'N/A', inline: false });
    }

    // Если есть автоматические нарушения за мат - показываем кратко
    if (autoBadwords.length > 0) {
      const lastAuto = autoBadwords.slice(-5).reverse();
      const autoText = lastAuto.map((v, i) => `${i+1}. ${v.reason} - ${new Date(v.timestamp).toLocaleDateString('ru-RU')}`).join('\n');
      embed.addFields({ name: '🤖 Последние авто-нарушения (мат)', value: autoText || 'N/A', inline: false });
    }

    // Если 3+ варна - показываем info о 24h бане
    if (activeWarnings >= 3) {
      embed.addFields({ 
        name: '⛔ ВНИМАНИЕ', 
        value: 'Пользователь получит автоматический мут на 24 часа после 3-го варна за 30 дней', 
        inline: false 
      });
    }

    // Кнопки для администраторов
    const adminRoles = require('../config').adminRoles || [];
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const isAdmin = member && member.roles && adminRoles.some(rid => member.roles.cache.has(rid));

    let components = [];
    if (isAdmin) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`infopol_clear_${userId}`)
          .setLabel('🗑️ Очистить данные')
          .setStyle(ButtonStyle.Danger)
      );
      components = [row];
    }

    await interaction.reply({ embeds: [embed], components, ephemeral: isAdmin });
  }
};
