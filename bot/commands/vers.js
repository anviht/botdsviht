const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { execSync } = require('child_process');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('версия')
    .setDescription('📦 Версия бота'),

  async execute(interaction) {
    try {
      // Получаем информацию о последнем коммите
      let commitHash = 'unknown';
      let commitMessage = 'No commits';
      let commitDate = 'unknown';

      try {
        commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        commitMessage = execSync('git log -1 --format=%B', { encoding: 'utf8' }).trim();
        commitDate = execSync('git log -1 --format=%ci', { encoding: 'utf8' }).trim().split(' ')[0];
      } catch (e) {
        // Git не установлен или не в репозитории
      }

      // Читаем версию из файла VERSION
      const fs = require('fs');
      const path = require('path');
      let version = '1.0.0';
      try {
        const vf = path.join(process.cwd(), 'VERSION');
        if (fs.existsSync(vf)) {
          version = fs.readFileSync(vf, 'utf8').trim();
        }
      } catch (e) { /* ignore */ }

      const embed = new EmbedBuilder()
        .setTitle('📦 Информация о боте')
        .setColor(0x00AE86)
        .addFields(
          { name: '🔢 Версия', value: `\`${version}\``, inline: true },
          { name: '📝 Последний коммит', value: `\`${commitHash}\``, inline: true },
          { name: '📅 Дата обновления', value: commitDate, inline: true }
        )
        .setFooter({ text: 'Viht Bot' })
        .setTimestamp();

      // Для администраторов показываем полное сообщение коммита
      const CONTROL_ROLE_ID = '1436485697392607303';
      const member = interaction.member || (interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
      const isAdmin = member && member.roles && member.roles.cache && member.roles.cache.has(CONTROL_ROLE_ID);
      
      if (isAdmin && commitMessage) {
        embed.addFields(
          { name: '💬 Описание коммита', value: `\`\`\`\n${commitMessage.substring(0, 200)}\n\`\`\``, inline: false }
        );
      }

      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      console.error('vers command error', e && e.message ? e.message : e);
      try { await interaction.reply({ content: '❌ Ошибка при выполнении команды.', ephemeral: true }); } catch (err) {}
    }
  }
};
