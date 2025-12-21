const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('снежок')
    .setDescription('❄️ Бросить снежок в другого пользователя')
    .addUserOption(opt => opt.setName('цель').setDescription('Кого ударить снежком?').setRequired(true)),

  async execute(interaction) {
    await db.ensureReady();
    const attacker = interaction.user;
    const target = interaction.options.getUser('цель');
    const attackerId = attacker.id;
    const targetId = target.id;

    // Проверка - не может бросить в себя
    if (attackerId === targetId) {
      const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('❄️ Снежный боевой дух!')
        .setDescription('Ты бросаешь снежок в себя и смеёшься! 😄')
        .addFields({ name: '📍 Результат', value: 'Самопомощь! Ты получил 10 поинтов за смелость!' })
        .setThumbnail(attacker.displayAvatarURL());
      await pointSystem.addPoints(attackerId, 10);
      return await interaction.reply({ embeds: [embed] });
    }

    // Проверка - не может бросить в бота
    if (target.bot) {
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❄️ Попытка атаки!')
        .setDescription(`Ты бросаешь снежок в ${target.username}...\n\nОн пролетает прямо сквозь него! 👻`)
        .addFields({ name: '❌ Результат', value: 'Ботов нельзя ударить снежками!' })
        .setThumbnail(target.displayAvatarURL());
      return await interaction.reply({ embeds: [embed] });
    }

    // Определяем успех атаки (70% шанс попадания)
    const hit = Math.random() < 0.7;
    const damage = Math.floor(Math.random() * 30) + 10; // 10-40 урона

    // Получаем статистику боевых действий
    const snowballStats = db.get('snowballStats') || {};
    const attackerStats = snowballStats[attackerId] || { hits: 0, misses: 0, totalDamage: 0, wins: 0, losses: 0 };
    const targetStats = snowballStats[targetId] || { hits: 0, misses: 0, totalDamage: 0, wins: 0, losses: 0 };

    // Обновляем статистику
    if (hit) {
      attackerStats.hits += 1;
      attackerStats.totalDamage += damage;
      targetStats.losses += 1;
    } else {
      attackerStats.misses += 1;
    }
    snowballStats[attackerId] = attackerStats;
    snowballStats[targetId] = targetStats;
    await db.set('snowballStats', snowballStats);

    // Определяем результат и награды
    let pointsReward = 0;
    let targetDamage = 0;
    let resultText = '';
    let emoji = '';

    if (hit) {
      pointsReward = Math.floor(damage / 2); // Вознаграждение за попадание
      targetDamage = damage;
      
      // Разные сообщения в зависимости от урона
      if (damage <= 15) {
        resultText = '✅ Ты ударил лёгким снежком!';
        emoji = '❄️';
      } else if (damage <= 25) {
        resultText = '⚡ Сильный удар снежком!';
        emoji = '❄️❄️';
      } else {
        resultText = '🎯 КРИТИЧЕСКИЙ УДАР! Снежная лавина!';
        emoji = '❄️❄️❄️';
        pointsReward *= 2; // Двойная награда за крит
      }
    } else {
      resultText = '❌ Промах! Снежок пролетел мимо!';
      emoji = '💨';
      pointsReward = 5; // Утешительная награда за попытку
    }

    // Добавляем поинты
    await pointSystem.addPoints(attackerId, pointsReward);
    if (hit) {
      // Жертва теряет половину урона в виде штрафа
      await pointSystem.addPoints(targetId, -Math.floor(targetDamage / 2));
    }

    // Проверяем достижения
    let achievement = null;
    if (attackerStats.hits === 10) {
      achievement = '❄️ Снежный воин! Первые 10 попаданий!';
      await pointSystem.addPoints(attackerId, 100);
    } else if (attackerStats.hits === 25) {
      achievement = '⚔️ Мастер снежных боёв! 25 попаданий!';
      await pointSystem.addPoints(attackerId, 250);
    }

    // Создаём основной embed атаки
    const embed = new EmbedBuilder()
      .setColor(hit ? '#0099FF' : '#FF6B6B')
      .setTitle(`${emoji} Снежная битва!`)
      .setDescription(`${attacker.username} бросил снежок в ${target.username}!\n\n${resultText}`)
      .addFields(
        { name: '💥 Урон', value: `${hit ? targetDamage : 0}`, inline: true },
        { name: '💰 Награда', value: `+${pointsReward} очков`, inline: true },
        { name: '📊 Статистика атакующего', value: `Попаданий: ${attackerStats.hits}\nПромахов: ${attackerStats.misses}\nОбщий урон: ${attackerStats.totalDamage}`, inline: true }
      )
      .setThumbnail(attacker.displayAvatarURL())
      .setFooter({ text: `${target.username} может ответить своим снежком!` });

    if (achievement) {
      embed.addFields({ name: '🏆 ДОСТИЖЕНИЕ!', value: achievement, inline: false });
    }

    // Кнопка для ответа
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`snowball_reply_${targetId}_${attackerId}`)
          .setLabel('⚔️ Ответить снежком')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.reply({ embeds: [embed], components: [row] });

    // Объявление в game канал если крит
    if (damage > 25) {
      try {
        const channelId = '1450486721878954006';
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (channel) {
          const announce = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🎯 КРИТИЧЕСКИЙ УДАР СНЕЖКОМ!')
            .setDescription(`${attacker.username} нанёс **${damage}** урона ${target.username}!`)
            .setThumbnail(attacker.displayAvatarURL());
          await channel.send({ embeds: [announce] });
        }
      } catch (e) {
        // Игнорируем
      }
    }
  }
};
