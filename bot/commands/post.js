const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder } = require('discord.js');

const ALLOWED_ROLE_ID = '1436485697392607303';

// Популярные цвета
const COLOR_PRESETS = {
  '🔴 Красный': 0xFF0000,
  '🟠 Оранжевый': 0xFFA500,
  '🟡 Жёлтый': 0xFFFF00,
  '🟢 Зелёный': 0x00FF00,
  '🔵 Синий': 0x0000FF,
  '🟣 Фиолетовый': 0x800080,
  '🟤 Коричневый': 0x8B4513,
  '🩶 Серый': 0x808080,
  '🤍 Белый': 0xFFFFFF,
  '⬛ Чёрный': 0x000000,
  '💗 Розовый': 0xFF1493,
  '🩵 Голубой': 0x00BFFF,
};

// Популярные стикеры/эмодзи
const STICKER_PRESETS = [
  '😀 Улыбка',
  '❤️ Сердце',
  '🎉 Праздник',
  '🚀 Ракета',
  '⭐ Звезда',
  '🔥 Огонь',
  '💪 Мышцы',
  '👏 Аплодисменты',
  '🎯 Цель',
  '✨ Блеск',
  '💯 Сотка',
  '🏆 Трофей',
  '📱 Телефон',
  '💻 Компьютер',
  '🎵 Музыка',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('пост')
    .setDescription('📝 Постить запись в выбранный канал')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Выбери канал для поста')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Проверка роли
    const member = interaction.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    // Получаем выбранный канал
    const targetChannel = interaction.options.getChannel('channel');
    
    if (!targetChannel || !targetChannel.isTextBased()) {
      return await interaction.reply({
        content: '❌ Выбери текстовый канал!',
        ephemeral: true
      });
    }

    // Проверяем права бота в канале
    const botMember = await targetChannel.guild.members.fetch(interaction.client.user.id).catch(() => null);
    const perms = targetChannel.permissionsFor(botMember || interaction.client.user);
    if (!perms || !perms.has(['SendMessages', 'EmbedLinks'])) {
      return await interaction.reply({
        content: '❌ У бота нет прав на постинг в этот канал!',
        ephemeral: true
      });
    }

    // Открываем модальное окно для ввода
    const modal = new ModalBuilder()
      .setCustomId(`post_modal_${targetChannel.id}`)
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

    const colorInput = new TextInputBuilder()
      .setCustomId('post_color')
      .setLabel('Цвет (hex или название)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('#FF006E или "Розовый"')
      .setValue('🔵 Синий');

    const buttonsInput = new TextInputBuilder()
      .setCustomId('post_buttons')
      .setLabel('Кнопки/ссылки (опционально)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder('Текст кнопки|https://ссылка\nЕщё кнопка|https://ссылка2');

    const row1 = new ActionRowBuilder().addComponents(titleInput);
    const row2 = new ActionRowBuilder().addComponents(descriptionInput);
    const row3 = new ActionRowBuilder().addComponents(imageInput);
    const row4 = new ActionRowBuilder().addComponents(colorInput);
    const row5 = new ActionRowBuilder().addComponents(buttonsInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);
  }
};

// Функция преобразования цвета
function parseColor(colorString) {
  if (!colorString) return 0x0099FF; // Дефолтный синий
  
  colorString = colorString.trim();
  
  // Если это hex
  if (colorString.startsWith('#')) {
    try {
      return parseInt(colorString.slice(1), 16);
    } catch (e) {
      return 0x0099FF;
    }
  }
  
  // Если это название из наших пресетов
  for (const [key, value] of Object.entries(COLOR_PRESETS)) {
    if (colorString.includes(key.split(' ')[1]) || key.includes(colorString)) {
      return value;
    }
  }
  
  return 0x0099FF;
}

// Обработчик модального окна
module.exports.handleModal = async (interaction) => {
  if (!interaction.customId.startsWith('post_modal_')) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    // Извлекаем ID канала из customId
    const channelId = interaction.customId.replace('post_modal_', '');
    const targetChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
    
    if (!targetChannel) {
      return await interaction.editReply({
        content: '❌ Канал больше не доступен!',
        ephemeral: true
      });
    }

    const title = interaction.fields.getTextInputValue('post_title') || null;
    const description = interaction.fields.getTextInputValue('post_description') || null;
    const imageUrl = interaction.fields.getTextInputValue('post_image') || null;
    const colorString = interaction.fields.getTextInputValue('post_color') || '🔵 Синий';
    const buttonsText = interaction.fields.getTextInputValue('post_buttons') || null;

    // Валидация - хотя бы что-то должно быть
    if (!title && !description && !imageUrl && !buttonsText) {
      return await interaction.editReply({
        content: '❌ Заполни хотя бы одно поле!',
        ephemeral: true
      });
    }

    // Парсим цвет
    const color = parseColor(colorString);

    // Строим embed БЕЗ автора (тега)
    const embed = new EmbedBuilder()
      .setColor(color);

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

    const sentMessage = await targetChannel.send(messageData).catch(err => {
      throw new Error('Ошибка при отправке: ' + (err.message || err));
    });

    // Успешное сообщение
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Пост опубликован!')
      .setColor(0x2ECC71)
      .setDescription(`[Перейти к посту](${sentMessage.url})`)
      .addFields(
        { name: 'Канал', value: `<#${channelId}>`, inline: false },
        { name: 'Заголовок', value: title || '❌ Не указан', inline: false },
        { name: 'Текст', value: description ? description.substring(0, 100) + (description.length > 100 ? '...' : '') : '❌ Не указан', inline: false },
        { name: 'Цвет', value: `#${color.toString(16).toUpperCase().padStart(6, '0')}`, inline: true },
        { name: 'Фото', value: imageUrl ? '✅ Добавлено' : '❌ Не добавлено', inline: true },
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
