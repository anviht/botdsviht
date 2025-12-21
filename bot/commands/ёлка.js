const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

// Различные украшения для ёлки
const DECORATIONS = [
  { emoji: '🔴', name: 'Красный шар', rarity: 'common' },
  { emoji: '🟢', name: 'Зелёный шар', rarity: 'common' },
  { emoji: '🟡', name: 'Жёлтый шар', rarity: 'common' },
  { emoji: '🔵', name: 'Синий шар', rarity: 'common' },
  { emoji: '⭐', name: 'Звезда', rarity: 'rare' },
  { emoji: '❄️', name: 'Снежинка', rarity: 'rare' },
  { emoji: '🎄', name: 'Маленькая ёлка', rarity: 'rare' },
  { emoji: '🎅', name: 'Дед Мороз', rarity: 'epic' },
  { emoji: '🤶', name: 'Снегурочка', rarity: 'epic' },
  { emoji: '🎁', name: 'Подарок', rarity: 'epic' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ёлка')
    .setDescription('🎄 Украсить новогоднюю ёлку - 1 раз в день'),

  async execute(interaction) {
    await db.ensureReady();
    const userId = interaction.user.id;
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Получаем данные
    const christmasData = db.get('christmasData') || {};
    const userChristmas = christmasData[userId] || { lastDecorated: null, decorations: 0, rareItems: 0 };

    // Проверка - украшал ли уже сегодня
    if (userChristmas.lastDecorated === today) {
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Ты уже украсил ёлку сегодня!')
        .setDescription('Приходи завтра! ⏰')
        .setThumbnail(interaction.user.displayAvatarURL());
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Выбираем случайное украшение (редкие предметы редче)
    const rand = Math.random();
    let decoration;
    if (rand < 0.02) { // 2% на epic
      decoration = DECORATIONS.filter(d => d.rarity === 'epic')[Math.floor(Math.random() * 3)];
    } else if (rand < 0.15) { // 13% на rare
      decoration = DECORATIONS.filter(d => d.rarity === 'rare')[Math.floor(Math.random() * 3)];
    } else { // 85% на common
      decoration = DECORATIONS.filter(d => d.rarity === 'common')[Math.floor(Math.random() * 4)];
    }

    // Обновляем данные
    userChristmas.lastDecorated = today;
    userChristmas.decorations = (userChristmas.decorations || 0) + 1;
    if (decoration.rarity !== 'common') {
      userChristmas.rareItems = (userChristmas.rareItems || 0) + 1;
    }
    christmasData[userId] = userChristmas;
    await db.set('christmasData', christmasData);

    // Добавляем поинты
    const points = decoration.rarity === 'epic' ? 150 : decoration.rarity === 'rare' ? 75 : 25;
    await pointSystem.addPoints(userId, points);

    // Получаем глобальный счётчик
    const globalTree = db.get('globalChristmasTree') || { decorations: 0, list: [] };
    globalTree.decorations += 1;
    globalTree.list.push({
      emoji: decoration.emoji,
      user: interaction.user.username,
      time: new Date().toLocaleTimeString('ru-RU')
    });
    // Храним только последние 50 украшений
    if (globalTree.list.length > 50) {
      globalTree.list.shift();
    }
    await db.set('globalChristmasTree', globalTree);

    // Проверяем достижения
    let achievement = null;
    if (userChristmas.decorations === 1) {
      achievement = '🎄 Первое украшение! Ёлка начинает сиять!';
    } else if (userChristmas.decorations === 10) {
      achievement = '🎄 Ёлочных дел мастер! 10 украшений!';
      await pointSystem.addPoints(userId, 100); // Бонус за достижение
    } else if (userChristmas.decorations === 25) {
      achievement = '✨ Снежный волшебник! 25 украшений!';
      await pointSystem.addPoints(userId, 250);
    } else if (userChristmas.decorations === 50) {
      achievement = '👑 Королевство праздника! 50 украшений! Получи роль "Праздничный дух"';
      await pointSystem.addPoints(userId, 500);
    }

    // Создаём embed
    const embed = new EmbedBuilder()
      .setColor(decoration.rarity === 'epic' ? '#FFD700' : decoration.rarity === 'rare' ? '#8B4789' : '#00AA00')
      .setTitle(`🎄 Украшение на ёлку!`)
      .setDescription(`Ты повесил **${decoration.emoji} ${decoration.name}**`)
      .addFields(
        { name: '⭐ Редкость', value: decoration.rarity === 'epic' ? 'ЛЕГЕНДАРНОЕ 👑' : decoration.rarity === 'rare' ? 'РЕДКОЕ ✨' : 'ОБЫЧНОЕ', inline: true },
        { name: '💎 Награда', value: `+${points} очков`, inline: true },
        { name: '📊 Твой вклад', value: `${userChristmas.decorations} украшений на ёлке`, inline: true },
        { name: '🌲 На ёлке всего', value: `${globalTree.decorations} украшений`, inline: true }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setFooter({ text: `Приходи завтра, чтобы повесить ещё одно украшение!` });

    if (achievement) {
      embed.addFields(
        { name: '🏆 ДОСТИЖЕНИЕ!', value: achievement, inline: false }
      );
    }

    await interaction.reply({ embeds: [embed] });

    // Показываем глобальную ёлку в канал если есть достижение
    if (achievement) {
      try {
        const channelId = '1450486721878954006'; // Game канал
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const treeEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`🎄 Ёлка сверкает новыми украшениями!`)
            .setDescription(`${interaction.user.username} получил достижение: **${achievement}**`)
            .setThumbnail(interaction.user.displayAvatarURL());
          await channel.send({ embeds: [treeEmbed] });
        }
      } catch (e) {
        // Игнорируем если канала нет
      }
    }
  }
};
