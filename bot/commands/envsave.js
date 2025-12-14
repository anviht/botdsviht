const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('envsave')
    .setDescription('💾 Сохранить отредактированный .env файл'),

  async execute(interaction) {
    // Проверка прав (роль)
    const ALLOWED_ROLE_ID = '1436485697392607303';
    const member = interaction.member;
    
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    try {
      await interaction.reply({
        content: '📝 Отправь содержимое отредактированного .env файла (весь текст полностью)',
        ephemeral: true
      });

      // Слушаем сообщение от пользователя
      const filter = m => m.author.id === interaction.user.id && m.channel.id === interaction.channel.id;
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 300000, errors: ['time'] })
        .catch(async () => {
          await interaction.followUp({
            content: '⏱️ Время ожидания истекло! Команда отменена.',
            ephemeral: true
          });
          return null;
        });

      if (!collected) return;

      const message = collected.first();
      let envContent = message.content;

      // Если текст в коде блоке, извлекаем его
      if (envContent.startsWith('```') && envContent.endsWith('```')) {
        envContent = envContent
          .replace(/^```[\w]*\n?/i, '') // Удаляем открывающий ```
          .replace(/\n?```$/, '');       // Удаляем закрывающий ```
      }

      // Базовая валидация (должны быть переменные окружения)
      if (!envContent.includes('=')) {
        return await interaction.followUp({
          content: '❌ Ошибка: содержимое не похоже на .env файл (должны быть переменные вида KEY=VALUE)',
          ephemeral: true
        });
      }

      const envPath = path.join(__dirname, '../../.env');

      // Создаем backup
      const backupPath = envPath + '.backup_' + Date.now();
      fs.copyFileSync(envPath, backupPath);

      // Сохраняем новое содержимое
      fs.writeFileSync(envPath, envContent, 'utf-8');

      const successEmbed = new EmbedBuilder()
        .setTitle('✅ .env успешно обновлен!')
        .setColor(0x2ECC71)
        .addFields(
          { name: '📊 Статус', value: 'Файл сохранен' },
          { name: '🔄 Перезагрузка', value: 'Бот перезагружается...' }
        )
        .setFooter({ text: 'Backup сохранен: ' + backupPath });

      await interaction.followUp({ embeds: [successEmbed] });

      // Удаляем исходное сообщение пользователя (содержит sensitive данные)
      await message.delete().catch(() => {});

      // Перезагружаем бота через pm2
      setTimeout(async () => {
        try {
          console.log('🔄 Перезагрузка бота через pm2...');
          
          // Используем pm2 для перезагрузки
          await execPromise('pm2 restart viht-bot', { cwd: path.join(__dirname, '../../..') });
          
          console.log('✅ Бот перезагружен успешно');
          
          await interaction.followUp({
            content: '🔄 **Бот перезагружен!** Изменения вступили в силу.',
            ephemeral: true
          });
        } catch (restartError) {
          console.error('❌ Ошибка перезагрузки:', restartError);
          
          // Если pm2 не работает, пытаемся использовать процесс Node
          await interaction.followUp({
            content: '⚠️ Не удалось перезагрузить через pm2. Попробуй перезагрузить бота вручную.',
            ephemeral: true
          });
        }
      }, 1000);

    } catch (error) {
      console.error('Ошибка при сохранении .env:', error);
      await interaction.followUp({
        content: '❌ Ошибка: ' + (error.message || error),
        ephemeral: true
      });
    }
  }
};
