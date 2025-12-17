const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../libs/db');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('💾 [АДМИН] Управление резервными копиями базы данных')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Создать резервную копию БД'))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Просмотреть список бэкапов'))
    .addSubcommand(sub => sub
      .setName('restore')
      .setDescription('Восстановить БД из бэкапа')
      .addStringOption(opt => opt.setName('backup_name').setDescription('Имя бэкапа').setRequired(true))),

  async execute(interaction) {
    await db.ensureReady();
    const config = require('../config');
    const sub = interaction.options.getSubcommand();

    // Только роль 1436485697392607303 может использовать эту команду
    const ALLOWED_ROLE_ID = '1436485697392607303';
    const hasRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);
    
    if (!hasRole) {
      return await interaction.reply({ content: '❌ Только администраторы могут это делать.', ephemeral: true });
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    if (sub === 'create') {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_${timestamp}.json`;
        const backupPath = path.join(backupDir, backupName);

        // Получить всю БД
        const allData = db.data || {};
        fs.writeFileSync(backupPath, JSON.stringify(allData, null, 2), 'utf8');

        const embed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('💾 Резервная копия создана')
          .addFields(
            { name: 'Имя файла', value: `\`${backupName}\``, inline: false },
            { name: 'Размер', value: `${fs.statSync(backupPath).size} байт`, inline: true },
            { name: 'Время', value: new Date().toLocaleString(), inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        return await interaction.reply({ content: `❌ Ошибка при создании бэкапа: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'list') {
      try {
        const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort().reverse();

        if (files.length === 0) {
          return await interaction.reply({ content: '💾 Резервных копий не найдено.', ephemeral: true });
        }

        const lines = files.slice(0, 10).map((f, i) => {
          const fullPath = path.join(backupDir, f);
          const stat = fs.statSync(fullPath);
          const size = (stat.size / 1024).toFixed(2);
          return `${i + 1}. \`${f}\` (${size} KB)`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setColor('#2196F3')
          .setTitle('💾 Резервные копии')
          .setDescription(lines)
          .setFooter({ text: `Всего бэкапов: ${files.length}` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        return await interaction.reply({ content: `❌ Ошибка: ${err.message}`, ephemeral: true });
      }
    }

    if (sub === 'restore') {
      try {
        const backupName = interaction.options.getString('backup_name');
        const backupPath = path.join(backupDir, backupName);

        if (!fs.existsSync(backupPath)) {
          return await interaction.reply({ content: `❌ Бэкап \`${backupName}\` не найден.`, ephemeral: true });
        }

        const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

        // Создать автоматический бэкап текущего состояния перед восстановлением
        const currentTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const autoBackupName = `auto_backup_before_restore_${currentTimestamp}.json`;
        const autoBackupPath = path.join(backupDir, autoBackupName);
        fs.writeFileSync(autoBackupPath, JSON.stringify(db.data || {}, null, 2), 'utf8');

        // Восстановить из бэкапа
        for (const key of Object.keys(backupData)) {
          await db.set(key, backupData[key]);
        }

        const embed = new EmbedBuilder()
          .setColor('#FFC107')
          .setTitle('💾 БД восстановлена')
          .addFields(
            { name: 'Восстановлено из', value: `\`${backupName}\``, inline: true },
            { name: 'Автобэкап текущих данных', value: `\`${autoBackupName}\``, inline: true },
            { name: 'Время', value: new Date().toLocaleString(), inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        return await interaction.reply({ content: `❌ Ошибка при восстановлении: ${err.message}`, ephemeral: true });
      }
    }
  }
};
