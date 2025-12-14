const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const TARGET_CHANNEL_ID = '1448413112423288903';
const ALLOWED_ROLE_ID = '1436485697392607303';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('📝 Постить запись в канал записей'),

  async execute(interaction) {
    // Проверка роли
    const member = interaction.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    // Открываем модальное окно для ввода
    const modal = new ModalBuilder()
      .setCustomId('post_modal')
      .setTitle('Создание поста');

    const titleInput = new TextInputBuilder()
      .setCustomId('post_title')
      .setLabel('Заголовок (опционально)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Введи заголовок или оставь пусто');

    const descriptionInput = new TextInputBuilder()
      .setCustomId('post_description')
      .setLabel('Описание/текст (опционально)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('Введи текст поста или оставь пусто');

    const imageInput = new TextInputBuilder()
      .setCustomId('post_image')
      .setLabel('Ссылка на фото (опционально)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('https://example.com/image.jpg');

    const stickerInput = new TextInputBuilder()
      .setCustomId('post_sticker')
      .setLabel('Стикер (опционально, ссылка или текст)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('Ссылка на стикер или описание');

    const buttonsInput = new TextInputBuilder()
      .setCustomId('post_buttons')
      .setLabel('Кнопки/ссылки (опционально)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('Название|https://ссылка\nЕщё кнопка|https://ссылка2');

    const row1 = new ActionRowBuilder().addComponents(titleInput);
    const row2 = new ActionRowBuilder().addComponents(descriptionInput);
    const row3 = new ActionRowBuilder().addComponents(imageInput);
    const row4 = new ActionRowBuilder().addComponents(stickerInput);
    const row5 = new ActionRowBuilder().addComponents(buttonsInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);
  }
};

// Обработчик модального окна
module.exports.handleModal = async (interaction) => {
  if (interaction.customId !== 'post_modal') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue('post_title') || null;
    const description = interaction.fields.getTextInputValue('post_description') || null;
    const imageUrl = interaction.fields.getTextInputValue('post_image') || null;
    const stickerText = interaction.fields.getTextInputValue('post_sticker') || null;
    const buttonsText = interaction.fields.getTextInputValue('post_buttons') || null;

    // Валидация - хотя бы что-то должно быть
    if (!title && !description && !imageUrl && !stickerText && !buttonsText) {
      return await interaction.editReply({
        content: '❌ Заполни хотя бы одно поле!',
        ephemeral: true
      });
    }

    const targetChannel = await interaction.client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
    if (!targetChannel) {
      return await interaction.editReply({
        content: '❌ Канал записей не найден!',
        ephemeral: true
      });
    }

    // Строим embed
    const embed = new EmbedBuilder()
      .setColor(0xFF006E)
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() });

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (imageUrl) {
      // Проверяем валидность URL
      try {
        new URL(imageUrl);
        embed.setImage(imageUrl);
      } catch {
        return await interaction.editReply({
          content: '❌ Некорректная ссылка на фото!',
          ephemeral: true
        });
      }
    }

    // Парсим кнопки
    let actionRow = null;
    if (buttonsText && buttonsText.trim()) {
      const lines = buttonsText.split('\n').filter(l => l.trim());
      const buttons = [];

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length === 2) {
          const label = parts[0].trim();
          const url = parts[1].trim();

          try {
            new URL(url);
            buttons.push(
              new ButtonBuilder()
                .setLabel(label.substring(0, 80))
                .setURL(url)
                .setStyle(ButtonStyle.Link)
            );
          } catch {
            return await interaction.editReply({
              content: `❌ Некорректная ссылка в кнопке: ${url}`,
              ephemeral: true
            });
          }

          if (buttons.length >= 5) break;
        }
      }

      if (buttons.length > 0) {
        actionRow = new ActionRowBuilder().addComponents(buttons);
      }
    }

    // Отправляем сообщение
    const messageData = { embeds: [embed] };
    if (actionRow) messageData.components = [actionRow];

    // Добавляем стикер если есть
    if (stickerText && stickerText.trim()) {
      // Если это URL, добавляем как текст в конец
      if (stickerText.startsWith('http')) {
        messageData.content = `🎨 Стикер: ${stickerText}`;
      } else {
        messageData.content = stickerText;
      }
    }

    const sentMessage = await targetChannel.send(messageData).catch(err => {
      throw new Error('Ошибка при отправке: ' + (err.message || err));
    });

    // Успешное сообщение
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Пост опубликован!')
      .setColor(0x2ECC71)
      .setDescription(`[Перейти к посту](${sentMessage.url})`)
      .addFields(
        { name: 'Заголовок', value: title || '❌ Не указан', inline: false },
        { name: 'Текст', value: description ? description.substring(0, 100) + (description.length > 100 ? '...' : '') : '❌ Не указан', inline: false },
        { name: 'Фото', value: imageUrl ? '✅ Добавлено' : '❌ Не добавлено', inline: true },
        { name: 'Стикер', value: stickerText ? '✅ Добавлено' : '❌ Не добавлено', inline: true },
        { name: 'Кнопки', value: actionRow ? `✅ ${actionRow.components.length} кнопок` : '❌ Нет', inline: true }
      );

    await interaction.editReply({
      embeds: [successEmbed],
      ephemeral: true
    });

  } catch (error) {
    console.error('Ошибка при обработке поста:', error);
    await interaction.editReply({
      content: '❌ Ошибка: ' + (error.message || error),
      ephemeral: true
    });
  }
};
