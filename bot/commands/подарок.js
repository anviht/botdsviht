const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

// Типы подарков с вероятностями
const GIFTS = [
  // Обычные подарки (65%)
  { emoji: '🎁', name: 'Обычный подарок', points: 50, rarity: 'common', probability: 0.30 },
  { emoji: '🎁', name: 'Замечательный подарок', points: 75, rarity: 'common', probability: 0.20 },
  { emoji: '🎁', name: 'Хороший подарок', points: 100, rarity: 'common', probability: 0.15 },

  // Редкие подарки (25%)
  { emoji: '✨', name: 'Сияющий подарок', points: 200, rarity: 'rare', probability: 0.12 },
  { emoji: '💎', name: 'Драгоценный подарок', points: 300, rarity: 'rare', probability: 0.08 },
  { emoji: '🌟', name: 'Звёздный подарок', points: 250, rarity: 'rare', probability: 0.05 },

  // Эпические подарки (8%)
  { emoji: '👑', name: 'Королевский подарок', points: 500, rarity: 'epic', probability: 0.06 },
  { emoji: '🏆', name: 'Легендарный сундук', points: 750, rarity: 'epic', probability: 0.02 },

  // Уголёк (2%)
  { emoji: '🪨', name: 'Уголёк от Деда Мороза', points: -25, rarity: 'coal', probability: 0.02 }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('подарок')
    .setDescription('🎁 Открыть новогодний подарок - 1 раз в день'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Получаем данные пользователя
    const giftData = db.get('giftData') || {};
    const userGifts = giftData[userId] || { lastGift: null, totalGifts: 0, totalPoints: 0, coals: 0, legends: 0 };

    // Проверка - открывал ли уже сегодня
    if (userGifts.lastGift === today) {
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Ты уже открыл подарок сегодня!')
        .setDescription('Приходи завтра! 🌙')
        .setThumbnail(interaction.user.displayAvatarURL());
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Выбираем подарок по вероятности
    const rand = Math.random();
    let cumulative = 0;
    let selectedGift = GIFTS[0];
    
    for (const gift of GIFTS) {
      cumulative += gift.probability;
      if (rand <= cumulative) {
        selectedGift = gift;
        break;
      }
    }

    // Обновляем данные
    userGifts.lastGift = today;
    userGifts.totalGifts += 1;
    userGifts.totalPoints += selectedGift.points;
    if (selectedGift.rarity === 'coal') userGifts.coals += 1;
    if (selectedGift.rarity === 'epic') userGifts.legends += 1;
    giftData[userId] = userGifts;
    await db.set('giftData', giftData);

    // Добавляем поинты
    await pointSystem.addPoints(userId, selectedGift.points);

    // Определяем цвет по редкости
    const colors = {
      'coal': '#8B8B8B',
      'common': '#4CAF50',
      'rare': '#2196F3',
      'epic': '#FFD700'
    };

    // Проверяем достижения
    let achievement = null;
    if (userGifts.totalGifts === 1) {
      achievement = '🎁 Первый подарок! Вот это удача!';
    } else if (userGifts.totalGifts === 7) {
      achievement = '🎁 Неделя подарков! 7 открытых коробок!';
      await pointSystem.addPoints(userId, 100);
    } else if (userGifts.legends >= 1) {
      achievement = '👑 ЛЕГЕНДАРНЫЙ ПОДАРОК! Редкая удача!';
      await pointSystem.addPoints(userId, 250);
    } else if (userGifts.coals >= 3) {
      achievement = '🪨 Три угольков! Мороз не в духе...';
    }

    // Реакция на уголёк
    let coalMessage = '';
    if (selectedGift.rarity === 'coal') {
      coalMessage = '\n\n⚠️ **НОУУУУ!** Дед Мороз думает, что ты был непослушным в этом году! 😢';
    }

    // Создаём embed
    const embed = new EmbedBuilder()
      .setColor(colors[selectedGift.rarity])
      .setTitle(`🎁 ${selectedGift.emoji} Открытие подарка!`)
      .setDescription(`Ты открыл: **${selectedGift.name}**${coalMessage}`)
      .addFields(
        { name: '⭐ Редкость', value: selectedGift.rarity === 'coal' ? '😡 УГОЛЁК' : selectedGift.rarity === 'epic' ? '👑 ЛЕГЕНДАРНОЕ' : selectedGift.rarity === 'rare' ? '✨ РЕДКОЕ' : '🟢 ОБЫЧНОЕ', inline: true },
        { name: '💰 Награда', value: `${selectedGift.points > 0 ? '+' : ''}${selectedGift.points} очков`, inline: true },
        { name: '📊 Всего подарков', value: `${userGifts.totalGifts} открыто`, inline: true },
        { name: '💎 Общий доход', value: `${userGifts.totalPoints} очков`, inline: true }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setFooter({ text: `Приходи завтра, чтобы открыть ещё один подарок!` });

    if (achievement) {
      embed.addFields(
        { name: '🏆 ДОСТИЖЕНИЕ!', value: achievement, inline: false }
      );
    }

    await interaction.reply({ embeds: [embed] });

    // Анонс в game-канал если легендарное
    if (selectedGift.rarity === 'epic') {
      try {
        const channelId = '1450486721878954006';
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const announce = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🎁 ЛЕГЕНДАРНЫЙ ПОДАРОК ОТКРЫТ!`)
            .setDescription(`${interaction.user.username} открыл **${selectedGift.name}**!\n\n+${selectedGift.points} поинтов!`)
            .setThumbnail(interaction.user.displayAvatarURL());
          await channel.send({ embeds: [announce] });
        }
      } catch (e) {
        // Игнорируем
      }
    }
  }
};
