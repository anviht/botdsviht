const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const db = require('../libs/db');

const ADMIN_ROLE_ID = '1436485697392607303';

// Модули которые можно включать/выключать
const MODULES = {
  'ai': { name: '🤖 AI Чат (/viht)', description: 'Персональный ИИ помощник' },
  'music': { name: '🎵 Музыкальный плеер', description: 'Воспроизведение музыки' },
  'moderation': { name: '🛡️ Модерация', description: 'Фильтр мата, блокировка' },
  'reactions': { name: '⭐ Реакции-роли', description: 'Выдача ролей по реакциям' },
  'economy': { name: '💰 Экономика', description: 'Баланс, транферы, дейлис' },
  'achievements': { name: '🏆 Достижения', description: 'Система ачивок' },
  'tickets': { name: '🎫 Тикеты', description: 'Система поддержки' },
  'post_manager': { name: '📝 Post Manager', description: 'Менеджер новостей' }
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vihtmoroz')
    .setDescription('Администратор: отключить/включить модули бота')
    .setDefaultMemberPermissions(0),
  
  async execute(interaction) {
    try {
      await db.ensureReady();
      
      // Проверка админа
      const adminRole = interaction.guild.roles.cache.get(ADMIN_ROLE_ID);
      if (!adminRole || !interaction.member.roles.has(ADMIN_ROLE_ID)) {
        return await interaction.reply({
          content: '❌ Команда только для администраторов!',
          ephemeral: true
        });
      }

      // Получаем состояние модулей из БД
      const moduleStates = db.get('botModules') || {};
      
      // Инициализируем все модули как включенные если нет в БД
      Object.keys(MODULES).forEach(key => {
        if (!(key in moduleStates)) {
          moduleStates[key] = true;
        }
      });

      // Создаем меню выбора
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('moroz_select')
          .setPlaceholder('Выбери модуль для управления...')
          .addOptions(
            Object.entries(MODULES).map(([key, info]) => ({
              label: info.name,
              description: info.description,
              value: key,
              emoji: moduleStates[key] ? '✅' : '❌'
            }))
          )
      );

      // Создаем эмбед с состоянием
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('❄️ Viht Moroz - Управление модулями')
        .setDescription('Выбери модуль ниже чтобы включить/отключить')
        .addFields(
          Object.entries(MODULES).map(([key, info]) => ({
            name: info.name,
            value: moduleStates[key] ? '✅ Включен' : '❌ Отключен',
            inline: true
          }))
        )
        .setFooter({ text: 'Команда: /vihtmoroz' })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        components: [selectRow],
        ephemeral: false
      });
    } catch (e) {
      console.error('[MOROZ] Error:', e.message);
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true }).catch(() => null);
    }
  }
};
