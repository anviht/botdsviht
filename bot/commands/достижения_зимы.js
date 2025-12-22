const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');

const GAME_CHANNEL_ID = '1450486721878954006';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('достижения_зимы')
    .setDescription('🏆 Просмотр новогодних достижений и статистики'),

  async execute(interaction) {
    // Проверка на правильный канал
    if (interaction.channelId !== GAME_CHANNEL_ID) {
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Неправильный канал!')
        .setDescription(`Эту команду можно использовать только в <#${GAME_CHANNEL_ID}>\n\nИди в игровой канал! 🎮`)
        .setThumbnail(interaction.user.displayAvatarURL());
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    await db.ensureReady();
    const userId = interaction.user.id;

    // Получаем все данные
    const christmasData = (db.get('christmasData') || {})[userId] || { decorations: 0, rareItems: 0 };
    const giftData = (db.get('giftData') || {})[userId] || { totalGifts: 0, totalPoints: 0, coals: 0, legends: 0 };
    const snowballStats = (db.get('snowballStats') || {})[userId] || { hits: 0, misses: 0, totalDamage: 0, wins: 0, losses: 0 };

    // Вычисляем достижения
    const achievements = [];

    // Ёлка достижения
    if (christmasData.decorations > 0) achievements.push('🎄 Украсил ёлку 1 раз');
    if (christmasData.decorations >= 10) achievements.push('🎄 Ёлочных дел мастер (10 украшений)');
    if (christmasData.decorations >= 25) achievements.push('✨ Снежный волшебник (25 украшений)');
    if (christmasData.decorations >= 50) achievements.push('👑 Королевство праздника (50 украшений)');

    // Подарок достижения
    if (giftData.totalGifts > 0) achievements.push('🎁 Открыл первый подарок');
    if (giftData.totalGifts >= 7) achievements.push('🎁 Неделя подарков (7 открыто)');
    if (giftData.legends >= 1) achievements.push('👑 Легендарный удачник (эпический подарок)');
    if (giftData.coals >= 1) achievements.push('🪨 Уголёк от Мороза (получил уголёк)');

    // Снежок достижения
    if (snowballStats.hits > 0) achievements.push('❄️ Первый снежный удар');
    if (snowballStats.hits >= 10) achievements.push('❄️ Снежный воин (10 попаданий)');
    if (snowballStats.hits >= 25) achievements.push('⚔️ Мастер снежных боёв (25 попаданий)');

    // Рассчитываем статистику
    const totalHits = snowballStats.hits;
    const totalAttempts = snowballStats.hits + snowballStats.misses;
    const hitRate = totalAttempts > 0 ? ((totalHits / totalAttempts) * 100).toFixed(1) : 0;

    // Создаём embed
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('🎄 НОВОГОДНЯЯ СТАТИСТИКА 🎄')
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        {
          name: '🎄 ЁЛКА',
          value: `Украшений: **${christmasData.decorations}**\nРедких предметов: **${christmasData.rareItems}**`,
          inline: true
        },
        {
          name: '🎁 ПОДАРКИ',
          value: `Открыто: **${giftData.totalGifts}**\nОбщая награда: **${giftData.totalPoints}** очков\nЛегендарных: **${giftData.legends}**\nУголька: **${giftData.coals}**`,
          inline: true
        },
        {
          name: '❄️ СНЕЖКИ',
          value: `Попаданий: **${totalHits}**\nПромахов: **${snowballStats.misses}**\nВсего урона: **${snowballStats.totalDamage}**\nТочность: **${hitRate}%**`,
          inline: true
        }
      );

    // Добавляем достижения если есть
    if (achievements.length > 0) {
      embed.addFields({
        name: '🏆 ДОСТИЖЕНИЯ (' + achievements.length + ')',
        value: achievements.map(a => '✅ ' + a).join('\n'),
        inline: false
      });
    } else {
      embed.addFields({
        name: '🏆 ДОСТИЖЕНИЯ',
        value: 'Пока нет достижений, начни с команд `/ёлка`, `/подарок`, `/снежок`!',
        inline: false
      });
    }

    embed.setFooter({
      text: `Развлекайся до конца новогодних праздников! 🎉`,
      iconURL: interaction.user.displayAvatarURL()
    });
    embed.setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
