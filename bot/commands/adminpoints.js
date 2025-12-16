const { SlashCommandBuilder } = require('discord.js');
const db = require('../libs/db');
const pointSystem = require('../libs/pointSystem');

const ADMIN_ROLE_ID = '1436485697392607303';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adminpoints')
    .setDescription('👨‍💼 Админ команда: добавить/убрать очки (только для администраторов)')
    .addUserOption(opt => opt.setName('user').setDescription('Пользователь').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Количество очков (может быть отрицательным)').setRequired(true)),

  async execute(interaction) {
    // Проверяем роль
    if (!interaction.member.roles.has(ADMIN_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет доступа к этой команде. Требуется специальная роль администратора.',
        ephemeral: true
      });
    }

    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (!targetUser) {
      return await interaction.reply({
        content: '❌ Пользователь не найден.',
        ephemeral: true
      });
    }

    if (amount === 0) {
      return await interaction.reply({
        content: '❌ Количество очков не может быть 0.',
        ephemeral: true
      });
    }

    try {
      await db.ensureReady();

      const gameStats = db.get('gameStats') || {};
      if (!gameStats[targetUser.id]) {
        gameStats[targetUser.id] = {
          points: 0,
          wins: 0,
          losses: 0,
          messagesCount: 0,
          gamesPlayed: {},
          achievements: []
        };
      }

      const oldPoints = gameStats[targetUser.id].points || 0;
      const newPoints = Math.max(0, oldPoints + amount);
      gameStats[targetUser.id].points = newPoints;

      await db.set('gameStats', gameStats);

      const emoji = amount > 0 ? '➕' : '➖';
      const reason = amount > 0 ? 'admin_add' : 'admin_remove';
      console.log(`[ADMIN] ${interaction.user.username} ${emoji} ${Math.abs(amount)} очков для ${targetUser.username}`);

      await interaction.reply({
        content: `${emoji} **${targetUser.username}**: ${oldPoints} → **${newPoints}** очков (${amount > 0 ? '+' : ''}${amount})`,
        ephemeral: false
      });

    } catch (e) {
      console.error('[ADMIN] Error:', e);
      await interaction.reply({
        content: '❌ Ошибка при изменении очков.',
        ephemeral: true
      });
    }
  }
};
