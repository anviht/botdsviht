const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('envedit')
    .setDescription('📝 Получить содержимое файла .env для редактирования'),

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
      const envPath = path.join(__dirname, '../../.env');
      
      // Проверка наличия файла
      if (!fs.existsSync(envPath)) {
        return await interaction.reply({
          content: '❌ Файл .env не найден!',
          ephemeral: true
        });
      }

      const envContent = fs.readFileSync(envPath, 'utf-8');

      // Если файл очень большой, отправляем с предупреждением
      if (envContent.length > 2000) {
        const embed = new EmbedBuilder()
          .setTitle('📄 Содержимое .env')
          .setColor(0xFFB700)
          .setDescription('Файл слишком большой! Отправляю первые 2000 символов:')
          .addFields({
            name: 'Содержимое',
            value: '```\n' + envContent.substring(0, 1990) + '\n...```'
          });

        await interaction.reply({ embeds: [embed] });
        await interaction.followUp({
          content: `⚠️ Файл обрезан! Полное содержимое:\n\`\`\`\n${envContent}\n\`\`\``,
          ephemeral: true
        });
      } else {
        const embed = new EmbedBuilder()
          .setTitle('📄 Содержимое .env')
          .setColor(0x2ECC71)
          .addFields({
            name: 'Файл',
            value: '```\n' + envContent + '\n```'
          });

        await interaction.reply({ embeds: [embed] });
      }

      // Отправляем инструкцию
      await interaction.followUp({
        content: '📌 **Инструкция:**\n1. Скопируй содержимое выше\n2. Отредактируй что нужно\n3. Используй `/envsave` и отправь отредактированный текст',
        ephemeral: true
      });

    } catch (error) {
      console.error('Ошибка при чтении .env:', error);
      await interaction.reply({
        content: '❌ Ошибка при чтении файла: ' + (error.message || error),
        ephemeral: true
      });
    }
  }
};
