const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const statsTracker = require('../libs/statsTracker');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

const ALLOWED_ROLE = '1436485697392607303';

// Генерация красивого графика
async function generateChart(data, title, type = 'recent') {
  try {
    const dates = Object.keys(data).reverse().slice(-14); // Последние 14 дней
    const joins = dates.map(d => data[d]?.joins || 0);
    const boosts = dates.map(d => data[d]?.boosts || 0);
    
    const width = 1200;
    const height = 600;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
    
    const image = await chartJSNodeCanvas.drawChart({
      type: 'line',
      data: {
        labels: dates.map(d => d.split('-')[2]), // Только день месяца
        datasets: [
          {
            label: '👥 Входы',
            data: joins,
            borderColor: '#00ff00',
            backgroundColor: 'rgba(0, 255, 0, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#00ff00',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2
          },
          {
            label: '⭐ Бусты',
            data: boosts,
            borderColor: '#ffd700',
            backgroundColor: 'rgba(255, 215, 0, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#ffd700',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              font: { size: 14, weight: 'bold' },
              color: '#ffffff',
              padding: 15
            }
          },
          title: {
            display: true,
            text: title,
            font: { size: 20, weight: 'bold' },
            color: '#ffffff',
            padding: 20
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#ffffff',
              font: { size: 12 }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#ffffff',
              font: { size: 12 }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
    
    return image;
  } catch (e) {
    console.error('[grafs] Chart generation error:', e.message);
    return null;
  }
}

// Создание красивого embed'а со статистикой
function createStatsEmbed(data, title, emoji) {
  const dates = Object.keys(data).reverse();
  
  // Вычисляем статистику
  const totalJoins = dates.reduce((sum, d) => sum + (data[d]?.joins || 0), 0);
  const totalBoosts = dates.reduce((sum, d) => sum + (data[d]?.boosts || 0), 0);
  const avgJoins = Math.round(totalJoins / dates.length);
  
  // Найти макс и мин
  const joinsArray = dates.map(d => data[d]?.joins || 0);
  const maxJoins = Math.max(...joinsArray);
  const minJoins = Math.min(...joinsArray);
  
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
        value: `\`${minJoins}\``,
        inline: true
      },
      {
        name: '📅 Дней данных',
        value: `\`${dates.length}\``,
        inline: true
      }
    );
  
  // Добавить роли если есть
  if (Object.keys(allRoles).length > 0) {
    const rolesText = Object.entries(allRoles)
      .map(([role, count]) => `• **${role}**: ${count}`)
      .join('\n');
    
    embed.addField('👑 Распределение ролей', rolesText, false);
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
            value: 'Демонстрационные данные',
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
        title = 'Статистика за 7 дней';
        emoji = '📊';
      } else if (customId === 'grafs_all') {
        data = statsTracker.getAllStats();
        title = 'Полная статистика (30 дней)';
        emoji = '📈';
      } else if (customId === 'grafs_test') {
        data = statsTracker.getTestStats();
        title = 'Тестовая статистика';
        emoji = '🧪';
      } else {
        return;
      }
      
      // Показываем что загружаем
      await interaction.deferUpdate();
      
      // Создаем embed со статистикой
      const statsEmbed = createStatsEmbed(data, title, emoji);
      
      // Генерируем график
      const chartImage = await generateChart(data, title);
      
      if (chartImage) {
        const attachment = new AttachmentBuilder(chartImage, { name: 'stats-chart.png' });
        statsEmbed.setImage('attachment://stats-chart.png');
        
        // Отправляем результат с графиком
        const backRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('grafs_back')
              .setLabel('⬅️ Вернуться')
              .setStyle(ButtonStyle.Secondary)
          );
        
        await interaction.editReply({
          embeds: [statsEmbed],
          files: [attachment],
          components: [backRow],
          ephemeral: false
        });
      } else {
        // Если график не сгенерировался, показываем только статистику
        const backRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('grafs_back')
              .setLabel('⬅️ Вернуться')
              .setStyle(ButtonStyle.Secondary)
          );
        
        await interaction.editReply({
          embeds: [statsEmbed],
          components: [backRow],
          ephemeral: false
        });
      }
      
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
            value: 'Демонстрационные данные',
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
