const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const statsTracker = require('../libs/statsTracker');

const ALLOWED_ROLE = '1436485697392607303';

// Простая текстовая визуализация графика (ASCII art)
function createAsciiChart(data, title) {
  const dates = Object.keys(data).sort();
  
  if (dates.length === 0) {
    return `Нет данных`;
  }
  
  const joins = dates.map(d => data[d]?.joins || 0);
  const maxValue = Math.max(...joins, 1);
  
  let chart = `\`\`\`\n${title}\n`;
  chart += `\n`;
  
  // Шкала по вертикали
  for (let i = maxValue; i >= 0; i--) {
    const lineNum = String(i).padStart(3);
    chart += `${lineNum} │ `;
    
    for (let j = 0; j < joins.length; j++) {
      const value = joins[j];
      if (value >= i) {
        chart += `█ `;
      } else {
        chart += `  `;
      }
    }
    chart += `\n`;
  }
  
  // Линия снизу
  chart += `    └`;
  for (let j = 0; j < joins.length; j++) {
    chart += `──`;
  }
  chart += `\n`;
  
  // Дни снизу
  chart += `     `;
  for (let j = 0; j < dates.length; j++) {
    const day = dates[j].split('-')[2];
    chart += ` ${day}`;
  }
  chart += `\n\`\`\``;
  
  return chart;
}

// Создание красивого embed'а со статистикой
function createStatsEmbed(data, title, emoji) {
  const dates = Object.keys(data).sort();
  
  if (dates.length === 0) {
    return new EmbedBuilder()
      .setTitle(`${emoji} ${title}`)
      .setColor(0xFF0000)
      .setDescription('❌ Нет данных для отображения')
      .setFooter({ text: '📈 Статистика сервера • ' + new Date().toLocaleString('ru-RU') })
      .setTimestamp();
  }
  
  // Вычисляем статистику
  const totalJoins = dates.reduce((sum, d) => sum + (data[d]?.joins || 0), 0);
  const totalBoosts = dates.reduce((sum, d) => sum + (data[d]?.boosts || 0), 0);
  const avgJoins = dates.length > 0 ? Math.round(totalJoins / dates.length) : 0;
  
  // Найти макс и мин
  const joinsArray = dates.map(d => data[d]?.joins || 0).filter(j => j > 0);
  const maxJoins = joinsArray.length > 0 ? Math.max(...joinsArray) : 0;
  const minJoins = joinsArray.length > 0 ? Math.min(...joinsArray) : 0;
  
  // Роли
  const allRoles = {};
  dates.forEach(d => {
    const dayRoles = data[d]?.roles || {};
    Object.keys(dayRoles).forEach(role => {
      allRoles[role] = (allRoles[role] || 0) + dayRoles[role];
    });
  });
  
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${title}`)
    .setColor(0x00ff00)
    .setDescription(`📊 Статистика за ${dates.length} день(ей)`)
    .addFields(
      {
        name: '👥 Всего входов',
        value: `\`${totalJoins}\``,
        inline: true
      },
      {
        name: '⭐ Всего бустов',
        value: `\`${totalBoosts}\``,
        inline: true
      },
      {
        name: '📊 Среднее в день',
        value: `\`${avgJoins}\``,
        inline: true
      },
      {
        name: '⬆️ Максимум в день',
        value: `\`${maxJoins}\``,
        inline: true
      },
      {
        name: '⬇️ Минимум в день',
        value: `\`${minJoins > 0 ? minJoins : '0'}\``,
        inline: true
      },
      {
        name: '📅 Дней данных',
        value: `\`${dates.length}\``,
        inline: true
      }
    );
  
  // Добавить ASCII график
  const asciiChart = createAsciiChart(data, 'График входов 👥');
  embed.addFields([
    {
      name: '📈 График входов',
      value: asciiChart,
      inline: false
    }
  ]);
  
  // Добавить роли если есть
  if (Object.keys(allRoles).length > 0) {
    const rolesText = Object.entries(allRoles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([role, count]) => `• **${role}**: ${count}`)
      .join('\n');
    
    if (rolesText) {
      embed.addFields([
        {
          name: '👑 ТОП роли',
          value: rolesText,
          inline: false
        }
      ]);
    }
  }
  
  embed.setFooter({ text: '📈 Статистика сервера • ' + new Date().toLocaleString('ru-RU') });
  embed.setTimestamp();
  
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grafs')
    .setDescription('📊 Показать красивую статистику сервера'),
  
  async execute(interaction) {
    try {
      // Проверка роли
      const member = interaction.member;
      if (!member.roles.cache.has(ALLOWED_ROLE)) {
        return await interaction.reply({
          content: '❌ Эта команда доступна только администраторам!',
          ephemeral: true
        });
      }
      
      // Инициализируем трекер
      statsTracker.initStats();
      
      // Создаем кнопки для выбора периода
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('grafs_recent')
            .setLabel('📅 Актуальная (7 дней)')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setCustomId('grafs_all')
            .setLabel('📆 За все время (30 дней)')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📈'),
          new ButtonBuilder()
            .setCustomId('grafs_test')
            .setLabel('🧪 Тестовая')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✨')
        );
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Статистика Сервера')
        .setColor(0x7289da)
        .setDescription('Выберите какую статистику вы хотите посмотреть:')
        .addFields(
          {
            name: '📊 Актуальная статистика',
            value: 'Статистика за последние 7 дней',
            inline: false
          },
          {
            name: '📈 Статистика за все время',
            value: 'Полная статистика за 30 дней',
            inline: false
          },
          {
            name: '🧪 Тестовая статистика',
            value: 'Демонстрационные данные для примера',
            inline: false
          }
        )
        .setFooter({ text: '🎯 Кликните кнопку чтобы посмотреть' })
        .setTimestamp();
      
      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: false
      });
      
    } catch (e) {
      console.error('[grafs] Error:', e);
      await interaction.reply({
        content: '❌ Ошибка при загрузке статистики',
        ephemeral: true
      });
    }
  },
  
  // Обработчики кнопок
  async handleButton(interaction) {
    try {
      const customId = interaction.customId;
      console.log('[grafs] Button clicked:', customId);
      
      // Проверка роли
      const member = interaction.member;
      if (!member.roles.cache.has(ALLOWED_ROLE)) {
        return await interaction.reply({
          content: '❌ Эта команда доступна только администраторам!',
          ephemeral: true
        });
      }
      
      let data, title, emoji;
      
      if (customId === 'grafs_recent') {
        data = statsTracker.getStatsForDays(7);
        title = '📊 Статистика за 7 дней';
        emoji = '📊';
      } else if (customId === 'grafs_all') {
        data = statsTracker.getAllStats();
        title = '📈 Полная статистика (30 дней)';
        emoji = '📈';
      } else if (customId === 'grafs_test') {
        data = statsTracker.getTestStats();
        title = '🧪 Тестовая статистика';
        emoji = '🧪';
      } else {
        return;
      }
      
      console.log('[grafs] Data loaded - days:', Object.keys(data).length);
      
      // Показываем что загружаем
      await interaction.deferUpdate();
      
      // Создаем embed со статистикой
      const statsEmbed = createStatsEmbed(data, title, emoji);
      
      const backRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('grafs_back')
            .setLabel('⬅️ Вернуться')
            .setStyle(ButtonStyle.Secondary)
        );
      
      console.log('[grafs] Sending response');
      
      await interaction.editReply({
        embeds: [statsEmbed],
        components: [backRow],
        ephemeral: false
      });
      
    } catch (e) {
      console.error('[grafs] Button handler error:', e);
      await interaction.deferUpdate().catch(() => {});
    }
  },
  
  async handleBackButton(interaction) {
    try {
      // Проверка роли
      const member = interaction.member;
      if (!member.roles.cache.has(ALLOWED_ROLE)) {
        return await interaction.deferUpdate();
      }
      
      await interaction.deferUpdate();
      
      // Возвращаемся к главному меню
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('grafs_recent')
            .setLabel('📅 Актуальная (7 дней)')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setCustomId('grafs_all')
            .setLabel('📆 За все время (30 дней)')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📈'),
          new ButtonBuilder()
            .setCustomId('grafs_test')
            .setLabel('🧪 Тестовая')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✨')
        );
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Статистика Сервера')
        .setColor(0x7289da)
        .setDescription('Выберите какую статистику вы хотите посмотреть:')
        .addFields(
          {
            name: '📊 Актуальная статистика',
            value: 'Статистика за последние 7 дней',
            inline: false
          },
          {
            name: '📈 Статистика за все время',
            value: 'Полная статистика за 30 дней',
            inline: false
          },
          {
            name: '🧪 Тестовая статистика',
            value: 'Демонстрационные данные для примера',
            inline: false
          }
        )
        .setFooter({ text: '🎯 Кликните кнопку чтобы посмотреть' })
        .setTimestamp();
      
      await interaction.editReply({
        embeds: [embed],
        components: [row]
      });
      
    } catch (e) {
      console.error('[grafs] Back button error:', e);
    }
  }
};
