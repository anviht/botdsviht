const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('../libs/db');

const ALLOWED_ROLE_ID = '1436485697392607303';
const BADWORDS_FILE = path.join(__dirname, '../moderation/badwords.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('🚫 Панель модерации (автомод, фильтры, запретные слова)'),

  async execute(interaction) {
    // Проверка роли
    const member = interaction.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    await db.ensureReady();
    const modSettings = db.get(`mod_${interaction.guildId}`) || {
      automodEnabled: true,
      filterLinks: true,
      filterSpam: true
    };

    // Читаем запретные слова
    let badwordsCount = 0;
    try {
      if (fs.existsSync(BADWORDS_FILE)) {
        const data = JSON.parse(fs.readFileSync(BADWORDS_FILE, 'utf8'));
        badwordsCount = data.words ? data.words.length : 0;
      }
    } catch (e) {
      console.error('Error reading badwords:', e);
    }

    // Создаём главную панель
    const embed = new EmbedBuilder()
      .setTitle('🚫 Панель модерации')
      .setColor(0xe74c3c)
      .setDescription('Управляй модерацией сервера')
      .addFields(
        { name: '🤖 Автомод', value: modSettings.automodEnabled ? '✅ Включён' : '❌ Выключен', inline: true },
        { name: '🔗 Фильтр ссылок', value: modSettings.filterLinks ? '✅ Включён' : '❌ Выключен', inline: true },
        { name: '📨 Фильтр спама', value: modSettings.filterSpam ? '✅ Включён' : '❌ Выключен', inline: true },
        { name: '🔤 Запретные слова', value: `${badwordsCount} слов(а)`, inline: true }
      )
      .setFooter({ text: 'Нажми на кнопку для изменения' });

    const automodBtn = new ButtonBuilder()
      .setCustomId('mod_automod_toggle')
      .setLabel('Автомод')
      .setStyle(modSettings.automodEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji('🤖');

    const linksBtn = new ButtonBuilder()
      .setCustomId('mod_links_toggle')
      .setLabel('Ссылки')
      .setStyle(modSettings.filterLinks ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji('🔗');

    const spamBtn = new ButtonBuilder()
      .setCustomId('mod_spam_toggle')
      .setLabel('Спам')
      .setStyle(modSettings.filterSpam ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji('📨');

    const badwordsBtn = new ButtonBuilder()
      .setCustomId('mod_badwords_manage')
      .setLabel('Запретные слова')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔤');

    const row1 = new ActionRowBuilder().addComponents(automodBtn, linksBtn, spamBtn);
    const row2 = new ActionRowBuilder().addComponents(badwordsBtn);

    await interaction.reply({
      embeds: [embed],
      components: [row1, row2],
      ephemeral: true
    });
  }
};

// Обработчик кнопок
module.exports.handleButton = async (interaction) => {
  if (!interaction.customId.startsWith('mod_')) return;

  const member = interaction.member;
  if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return await interaction.reply({
      content: '❌ У тебя нет прав!',
      ephemeral: true
    });
  }

  await db.ensureReady();
  const modSettings = db.get(`mod_${interaction.guildId}`) || {
    automodEnabled: true,
    filterLinks: true,
    filterSpam: true
  };

  if (interaction.customId === 'mod_automod_toggle') {
    modSettings.automodEnabled = !modSettings.automodEnabled;
    await db.set(`mod_${interaction.guildId}`, modSettings);
    
    await interaction.reply({
      content: `✅ Автомод ${modSettings.automodEnabled ? '✅ включён' : '❌ выключен'}`,
      ephemeral: true
    });
  }

  if (interaction.customId === 'mod_links_toggle') {
    modSettings.filterLinks = !modSettings.filterLinks;
    await db.set(`mod_${interaction.guildId}`, modSettings);
    
    await interaction.reply({
      content: `✅ Фильтр ссылок ${modSettings.filterLinks ? '✅ включён' : '❌ выключен'}`,
      ephemeral: true
    });
  }

  if (interaction.customId === 'mod_spam_toggle') {
    modSettings.filterSpam = !modSettings.filterSpam;
    await db.set(`mod_${interaction.guildId}`, modSettings);
    
    await interaction.reply({
      content: `✅ Фильтр спама ${modSettings.filterSpam ? '✅ включён' : '❌ выключен'}`,
      ephemeral: true
    });
  }

  if (interaction.customId === 'mod_badwords_manage') {
    const select = new SelectMenuBuilder()
      .setCustomId('mod_badwords_select')
      .setPlaceholder('Выбери действие')
      .addOptions(
        { label: 'Добавить слово', value: 'add' },
        { label: 'Удалить слово', value: 'remove' },
        { label: 'Показать список', value: 'list' }
      );

    const row = new ActionRowBuilder().addComponents(select);
    await interaction.reply({
      content: '🔤 Управление запретными словами:',
      components: [row],
      ephemeral: true
    });
  }
};

// Обработчик селектов
module.exports.handleSelect = async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  const member = interaction.member;
  if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return await interaction.reply({
      content: '❌ У тебя нет прав!',
      ephemeral: true
    });
  }

  if (interaction.customId === 'mod_badwords_select') {
    const action = interaction.values[0];

    if (action === 'add') {
      const modal = new ModalBuilder()
        .setCustomId('mod_badwords_add_modal')
        .setTitle('Добавить запретное слово');

      const input = new TextInputBuilder()
        .setCustomId('word_input')
        .setLabel('Слово или фраза')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Введи слово')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }

    if (action === 'remove') {
      const modal = new ModalBuilder()
        .setCustomId('mod_badwords_remove_modal')
        .setTitle('Удалить запретное слово');

      const input = new TextInputBuilder()
        .setCustomId('word_input')
        .setLabel('Слово или фраза')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Введи слово')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }

    if (action === 'list') {
      try {
        if (!fs.existsSync(BADWORDS_FILE)) {
          return await interaction.reply({
            content: '❌ Список запретных слов пуст',
            ephemeral: true
          });
        }

        const data = JSON.parse(fs.readFileSync(BADWORDS_FILE, 'utf8'));
        const words = data.words || [];

        if (words.length === 0) {
          return await interaction.reply({
            content: '❌ Список запретных слов пуст',
            ephemeral: true
          });
        }

        const chunks = [];
        for (let i = 0; i < words.length; i += 50) {
          chunks.push(words.slice(i, i + 50).join(', '));
        }

        const embed = new EmbedBuilder()
          .setTitle('📋 Список запретных слов')
          .setColor(0xe74c3c)
          .setDescription(`Всего: ${words.length} слов(а)\n\n${chunks[0]}`)
          .setFooter({ text: `Страница 1/${chunks.length}` });

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      } catch (e) {
        console.error('Error reading badwords:', e);
        await interaction.reply({
          content: '❌ Ошибка при чтении файла',
          ephemeral: true
        });
      }
    }
  }
};

// Обработчик модалей
module.exports.handleModal = async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  const member = interaction.member;
  if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
    return await interaction.reply({
      content: '❌ У тебя нет прав!',
      ephemeral: true
    });
  }

  if (interaction.customId === 'mod_badwords_add_modal') {
    try {
      const word = interaction.fields.getTextInputValue('word_input').toLowerCase().trim();

      if (word.length === 0) {
        return await interaction.reply({
          content: '❌ Слово не может быть пустым',
          ephemeral: true
        });
      }

      // Убедимся, что директория существует
      const dir = path.dirname(BADWORDS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Читаем текущий файл
      let data = { words: [] };
      try {
        if (fs.existsSync(BADWORDS_FILE)) {
          const content = fs.readFileSync(BADWORDS_FILE, 'utf8');
          data = JSON.parse(content);
        }
      } catch (parseErr) {
        console.warn('Could not parse badwords.json, creating new:', parseErr.message);
        data = { words: [] };
      }

      // Убеждаемся что words это массив
      if (!Array.isArray(data.words)) {
        data.words = [];
      }

      // Проверяем дубликат
      if (data.words.includes(word)) {
        return await interaction.reply({
          content: `❌ Слово "${word}" уже в списке`,
          ephemeral: true
        });
      }

      // Добавляем слово
      data.words.push(word);
      fs.writeFileSync(BADWORDS_FILE, JSON.stringify(data, null, 2), 'utf8');

      await interaction.reply({
        content: `✅ Слово "${word}" добавлено в список запретных (всего: ${data.words.length})`,
        ephemeral: true
      });
    } catch (e) {
      console.error('Error adding badword:', e);
      await interaction.reply({
        content: `❌ Ошибка при добавлении слова: ${e.message || e}`,
        ephemeral: true
      });
    }
  }

  if (interaction.customId === 'mod_badwords_remove_modal') {
    try {
      const word = interaction.fields.getTextInputValue('word_input').toLowerCase().trim();

      if (!fs.existsSync(BADWORDS_FILE)) {
        return await interaction.reply({
          content: '❌ Файл запретных слов не найден',
          ephemeral: true
        });
      }

      let data = { words: [] };
      try {
        const content = fs.readFileSync(BADWORDS_FILE, 'utf8');
        data = JSON.parse(content);
      } catch (parseErr) {
        console.warn('Could not parse badwords.json:', parseErr.message);
        return await interaction.reply({
          content: '❌ Ошибка при чтении файла',
          ephemeral: true
        });
      }

      if (!Array.isArray(data.words)) {
        data.words = [];
      }

      // Проверяем наличие слова
      const index = data.words.indexOf(word);
      if (index === -1) {
        return await interaction.reply({
          content: `❌ Слово "${word}" не найдено в списке`,
          ephemeral: true
        });
      }

      // Удаляем слово
      data.words.splice(index, 1);
      fs.writeFileSync(BADWORDS_FILE, JSON.stringify(data, null, 2), 'utf8');

      await interaction.reply({
        content: `✅ Слово "${word}" удалено из списка (осталось: ${data.words.length})`,
        ephemeral: true
      });
    } catch (e) {
      console.error('Error removing badword:', e);
      await interaction.reply({
        content: `❌ Ошибка при удалении слова: ${e.message || e}`,
        ephemeral: true
      });
    }
  }
};
