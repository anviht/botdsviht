const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../libs/db');

const PANEL_CHANNEL_ID = '1448413112423288903';

// In-memory session state for post creation
const postSessions = new Map();

// Color presets for embeds
const COLOR_PRESETS = {
  'red': 0xFF0000,
  'green': 0x00FF00,
  'blue': 0x0000FF,
  'yellow': 0xFFFF00,
  'purple': 0x800080,
  'cyan': 0x00FFFF,
  'white': 0xFFFFFF,
  'black': 0x000000,
  'orange': 0xFFA500
};

// Build initial post manager embed
function buildPostManagerEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📝 Менеджер постов')
    .setDescription('Создавай красивые посты и публикуй их в любой канал')
    .addFields(
      { name: '✨ Возможности', value: 'Выбор канала • Заголовок и текст • Прикрепление фото • Выбор цвета' },
      { name: '💡 Совет', value: 'Нажми кнопку ниже, чтобы начать создавать пост' }
    )
    .setFooter({ text: 'Post Manager v1.0' });
}

// Build control row
function buildControlRow() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('post_create')
        .setLabel('➕ Новый пост')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('post_preview')
        .setLabel('👁️ Просмотр')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('post_publish')
        .setLabel('📤 Опубликовать')
        .setStyle(ButtonStyle.Danger)
    );
}

// Post the initial manager panel to the channel
async function postPostManagerPanel(client) {
  try {
    console.log('[POST_MANAGER] Начало постинга панели...');
    
    const ch = await client.channels.fetch(PANEL_CHANNEL_ID).catch(err => {
      console.error('[POST_MANAGER] Ошибка при получении канала:', err.message);
      return null;
    });
    
    if (!ch) {
      console.warn('[POST_MANAGER] Канал не найден:', PANEL_CHANNEL_ID);
      return false;
    }

    console.log('[POST_MANAGER] Канал получен:', PANEL_CHANNEL_ID);

    const embed = buildPostManagerEmbed();
    const row = buildControlRow();

    try {
      await db.ensureReady();
      console.log('[POST_MANAGER] БД готова');
    } catch (dbErr) {
      console.warn('[POST_MANAGER] Ошибка при подготовке БД:', dbErr.message);
    }

    let existing = null;
    try {
      existing = db.get('postManagerPanel');
      console.log('[POST_MANAGER] Существующая запись:', existing);
    } catch (err) {
      console.warn('[POST_MANAGER] Ошибка при получении из БД:', err.message);
    }

    if (existing && existing.messageId) {
      console.log('[POST_MANAGER] Попытка обновить существующее сообщение:', existing.messageId);
      try {
        const msg = await ch.messages.fetch(existing.messageId).catch(err => {
          console.warn('[POST_MANAGER] Не удалось получить сообщение:', err.message);
          return null;
        });
        
        if (msg) {
          await msg.edit({ embeds: [embed], components: [row] }).catch(err => {
            console.error('[POST_MANAGER] Ошибка при редактировании:', err.message);
          });
          console.log('[POST_MANAGER] ✅ Панель обновлена:', msg.id);
          return true;
        } else {
          console.log('[POST_MANAGER] Сообщение не найдено, создаю новое');
        }
      } catch (err) {
        console.warn('[POST_MANAGER] Не удалось обновить, создаю новое:', err.message);
      }
    } else {
      console.log('[POST_MANAGER] Нет существующего сообщения, создаю новое');
    }

    // Создаём новое сообщение
    console.log('[POST_MANAGER] Отправляю новое сообщение в канал...');
    const msg = await ch.send({ embeds: [embed], components: [row] }).catch(e => {
      console.error('[POST_MANAGER] ❌ Не удалось создать панель:', e.message);
      return null;
    });

    if (msg) {
      console.log('[POST_MANAGER] ✅ Панель создана:', msg.id);
      try {
        await db.set('postManagerPanel', { channelId: ch.id, messageId: msg.id });
        console.log('[POST_MANAGER] ✅ Запись сохранена в БД');
      } catch (dbSetErr) {
        console.warn('[POST_MANAGER] Ошибка при сохранении в БД:', dbSetErr.message);
      }
      return true;
    }
    
    console.warn('[POST_MANAGER] ❌ Не удалось создать панель (msg is null)');
    return false;
  } catch (e) {
    console.error('[POST_MANAGER] ❌ Ошибка postPostManagerPanel:', e.message, e.stack);
    return false;
  }
}

// Create new post session
async function handlePostCreate(interaction) {
  try {
    const userId = interaction.user.id;
    
    postSessions.set(userId, {
      userId,
      title: '',
      content: '',
      color: 0x5865F2,
      targetChannelId: null,
      attachmentUrl: null
    });

    // Show channel selection
    const channelSelect = new ActionRowBuilder()
      .addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`post_channel_select_${userId}`)
          .setPlaceholder('📌 Выбери канал для публикации')
          .setMaxValues(1)
      );

    await interaction.reply({
      content: 'Выбери канал, где опубликовать пост:',
      components: [channelSelect],
      ephemeral: true
    }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handlePostCreate error:', e.message);
  }
}

// Handle channel selection
async function handleChannelSelect(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия не найдена. Нажми "Новый пост"', ephemeral: true }).catch(() => null);
    }

    const selectedChannelId = interaction.values[0];
    session.targetChannelId = selectedChannelId;
    console.log('[POST_MANAGER] Selected channel:', selectedChannelId);

    // Show title input modal
    const modal = new ModalBuilder()
      .setCustomId(`post_title_modal_${userId}`)
      .setTitle('📝 Заголовок поста')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('post_title')
            .setLabel('Заголовок')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('например: Важное объявление')
            .setMaxLength(256)
            .setRequired(true)
        )
      );

    // For SelectMenuInteraction, we must use showModal without deferring
    if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
      await interaction.showModal(modal);
    } else {
      await interaction.reply({ content: '❌ Неподдерживаемый тип интеракции', ephemeral: true });
    }
  } catch (e) {
    console.error('[POST_MANAGER] handleChannelSelect error:', e.message, e.stack);
    try {
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true });
    } catch (replyErr) {
      console.error('[POST_MANAGER] Failed to send error reply:', replyErr.message);
    }
  }
}

// Handle title input modal
async function handleTitleModal(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    session.title = interaction.fields.getTextInputValue('post_title');
    console.log('[POST_MANAGER] Заголовок установлен:', session.title);

    // Проверяем тип интеракции - если это ModalSubmitInteraction, используем reply
    // так как showModal() не работает с ModalSubmitInteraction
    if (interaction.isModalSubmit()) {
      // Show content input modal через новую интеракцию
      const modal = new ModalBuilder()
        .setCustomId(`post_content_modal_${userId}`)
        .setTitle('📄 Текст поста')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('post_content')
              .setLabel('Описание/Текст')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('напиши содержание поста...')
              .setMaxLength(4000)
              .setRequired(true)
          )
        );

      await interaction.showModal(modal);
    } else {
      await interaction.reply({ content: '❌ Неподдерживаемый тип интеракции', ephemeral: true });
    }
  } catch (e) {
    console.error('[POST_MANAGER] Ошибка handleTitleModal:', e.message);
    try {
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true });
    } catch (replyErr) {
      console.error('[POST_MANAGER] Не удалось отправить ошибку:', replyErr.message);
    }
  }
}

// Handle content input modal
async function handleContentModal(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    if (!interaction.isModalSubmit()) {
      return await interaction.reply({ content: '❌ Неподдерживаемый тип интеракции', ephemeral: true });
    }

    session.content = interaction.fields.getTextInputValue('post_content');
    console.log('[POST_MANAGER] Содержание установлено:', session.content.substring(0, 50) + '...');

    // Show color and image options
    const colorSelect = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`post_color_select_${userId}`)
          .setPlaceholder('🎨 Выбери цвет квадратика')
          .addOptions(
            { label: '🔴 Красный', value: 'red', emoji: '🔴' },
            { label: '🟢 Зелёный', value: 'green', emoji: '🟢' },
            { label: '🔵 Синий', value: 'blue', emoji: '🔵' },
            { label: '🟡 Жёлтый', value: 'yellow', emoji: '🟡' },
            { label: '🟣 Фиолетовый', value: 'purple', emoji: '🟣' },
            { label: '🔷 Голубой', value: 'cyan', emoji: '🔷' },
            { label: '🟠 Оранжевый', value: 'orange', emoji: '🟠' }
          )
      );

    const photoButtons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`post_add_image_${userId}`)
          .setLabel('🖼️ Прикрепить фото')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`post_skip_image_${userId}`)
          .setLabel('⏭️ Пропустить')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({
      content: '**Шаг 3: Оформление**\nВыбери цвет и прикрепи фото (опционально)',
      components: [colorSelect, photoButtons],
      ephemeral: true
    });
  } catch (e) {
    console.error('[POST_MANAGER] Ошибка handleContentModal:', e.message);
    try {
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true });
    } catch (replyErr) {
      console.error('[POST_MANAGER] Не удалось отправить ошибку:', replyErr.message);
    }
  }
}

// Handle color selection
async function handleColorSelect(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    const colorKey = interaction.values[0];
    session.color = COLOR_PRESETS[colorKey] || 0x5865F2;

    await interaction.reply({ content: `✅ Цвет установлен на **${colorKey}**`, ephemeral: true }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleColorSelect error:', e.message);
  }
}

// Handle add image button
async function handleAddImage(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    const modal = new ModalBuilder()
      .setCustomId(`post_image_modal_${userId}`)
      .setTitle('🖼️ Прикрепить фото')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('image_url')
            .setLabel('URL фото или ссылка')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setRequired(true)
        )
      );

    await interaction.showModal(modal).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleAddImage error:', e.message);
  }
}

// Handle image URL modal
async function handleImageModal(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    session.attachmentUrl = interaction.fields.getTextInputValue('image_url');
    await interaction.reply({ content: '✅ Фото добавлено!', ephemeral: true }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleImageModal error:', e.message);
  }
}

// Handle skip image button
async function handleSkipImage(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    session.attachmentUrl = null;
    await interaction.reply({ content: '⏭️ Фото пропущено', ephemeral: true }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleSkipImage error:', e.message);
  }
}

// Build post preview embed
function buildPostPreview(session) {
  const embed = new EmbedBuilder()
    .setColor(session.color)
    .setTitle(session.title || '(Заголовок не установлен)')
    .setDescription(session.content || '(Текст не установлен)');

  if (session.attachmentUrl) {
    embed.setImage(session.attachmentUrl);
  }

  const now = new Date();
  const timeStr = now.toLocaleString('ru-RU', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit', 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
  embed.setFooter({ text: `Опубликовал <@&1436485697392607303> • ${timeStr}` });
  return embed;
}

// Handle preview button
async function handlePostPreview(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session || !session.targetChannelId) {
      return await interaction.reply({ content: '❌ Нет активной сессии. Нажми "Новый пост"', ephemeral: true }).catch(() => null);
    }

    const preview = buildPostPreview(session);
    await interaction.reply({ embeds: [preview], ephemeral: true }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handlePostPreview error:', e.message);
  }
}

// Handle publish button
async function handlePostPublish(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Нет активной сессии', ephemeral: true }).catch(() => null);
    }

    if (!session.targetChannelId) {
      return await interaction.reply({ content: '❌ Канал не выбран', ephemeral: true }).catch(() => null);
    }

    if (!session.title || !session.content) {
      return await interaction.reply({ content: '❌ Заполни заголовок и текст', ephemeral: true }).catch(() => null);
    }

    // Publish to target channel
    const targetCh = await interaction.client.channels.fetch(session.targetChannelId).catch(() => null);
    if (!targetCh) {
      return await interaction.reply({ content: '❌ Канал не найден', ephemeral: true }).catch(() => null);
    }

    const embed = buildPostPreview(session);
    const published = await targetCh.send({ embeds: [embed] }).catch(e => {
      console.error('[POST_MANAGER] Failed to publish:', e.message);
      return null;
    });

    if (published) {
      await interaction.reply({ content: `✅ Пост опубликован в <#${session.targetChannelId}>`, ephemeral: true }).catch(() => null);
      // Clear session after publish
      postSessions.delete(userId);
    } else {
      await interaction.reply({ content: '❌ Ошибка при публикации', ephemeral: true }).catch(() => null);
    }
  } catch (e) {
    console.error('[POST_MANAGER] handlePostPublish error:', e.message);
  }
}

// Handle button interactions
async function handlePostManagerButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'post_create') {
    await handlePostCreate(interaction);
  } else if (customId === 'post_preview') {
    await handlePostPreview(interaction);
  } else if (customId === 'post_publish') {
    await handlePostPublish(interaction);
  } else if (customId.startsWith('post_add_image_')) {
    await handleAddImage(interaction);
  } else if (customId.startsWith('post_skip_image_')) {
    await handleSkipImage(interaction);
  }
}

// Handle select menu interactions
async function handlePostManagerSelect(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('post_channel_select_')) {
    await handleChannelSelect(interaction);
  } else if (customId.startsWith('post_color_select_')) {
    await handleColorSelect(interaction);
  }
}

// Handle modal submissions
async function handlePostManagerModal(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('post_title_modal_')) {
    await handleTitleModal(interaction);
  } else if (customId.startsWith('post_content_modal_')) {
    await handleContentModal(interaction);
  } else if (customId.startsWith('post_image_modal_')) {
    await handleImageModal(interaction);
  }
}

module.exports = {
  postPostManagerPanel,
  handlePostManagerButton,
  handlePostManagerSelect,
  handlePostManagerModal
};
