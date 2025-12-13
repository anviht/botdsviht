const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../libs/db');

const PANEL_CHANNEL_ID = '1448413112423288903';
const BOT_ID = '1441754848658981016';
const PUBLISHER_ROLE_ID = '1441756621586829355';

// In-memory session state for post creation
const postSessions = new Map();
// Track which users are in message input mode
const messageInputSessions = new Map();

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

// Функция для обработки эмодзи в тексте
// Преобразует текст так, чтобы эмодзи отображались правильно
async function processEmojiInText(text, client, guildId) {
  if (!text) return text;
  
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('[POST_MANAGER] Guild not found');
      return text;
    }
    
    const emojis = await guild.emojis.fetch().catch(() => null);
    if (!emojis || emojis.size === 0) {
      console.warn('[POST_MANAGER] No emojis found in guild');
      return text;
    }
    
    let processed = text;
    
    // Ищем все :name: паттерны
    const emojiPattern = /:(\w+):/g;
    const matches = [...text.matchAll(emojiPattern)];
    
    console.log(`[POST_MANAGER] Found ${matches.length} potential emojis in text`);
    
    // Обрабатываем каждый найденный эмодзи
    for (const match of matches) {
      const emojiName = match[1];
      const emojiObj = emojis.find(e => e.name === emojiName);
      
      if (emojiObj) {
        // Заменяем :name: на <:name:id> или <a:name:id> для анимированных
        const emojiFormat = emojiObj.animated ? `<a:${emojiName}:${emojiObj.id}>` : `<:${emojiName}:${emojiObj.id}>`;
        processed = processed.replace(`:${emojiName}:`, emojiFormat);
        console.log(`[POST_MANAGER] Converted :${emojiName}: to ${emojiFormat}`);
      } else {
        console.warn(`[POST_MANAGER] Emoji :${emojiName}: not found in guild`);
      }
    }
    
    console.log(`[POST_MANAGER] Final processed text: ${processed.substring(0, 100)}`);
    return processed;
  } catch (e) {
    console.error('[POST_MANAGER] Error processing emoji:', e.message);
    return text;
  }
}

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
      attachmentUrl: null,
      stage: 'awaiting_title' // Track which input we're waiting for
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
    session.stage = 'awaiting_title';
    console.log('[POST_MANAGER] Selected channel:', selectedChannelId);

    // Mark that this user is now entering message input mode
    messageInputSessions.set(userId, {
      stage: 'title',
      channelId: PANEL_CHANNEL_ID,
      startTime: Date.now()
    });

    await interaction.reply({
      content: `✅ Канал выбран: <#${selectedChannelId}>\n\n📝 **Теперь напиши в этот канал:**\n1️⃣ **Сначала** - заголовок поста\n2️⃣ **Затем** - содержание поста\n\n*Сообщения будут автоматически обработаны*`,
      ephemeral: true
    });
  } catch (e) {
    console.error('[POST_MANAGER] handleChannelSelect error:', e.message, e.stack);
    try {
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true });
    } catch (replyErr) {
      console.error('[POST_MANAGER] Failed to send error reply:', replyErr.message);
    }
  }
}

// Handle title input modal (deprecated - now using message input)
async function handleTitleModal(interaction) {
  try {
    await interaction.reply({ content: '❌ Эта функция больше не используется. Используй обычное сообщение в чате.', ephemeral: true }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] Ошибка handleTitleModal:', e.message);
  }
}

// Handle content input modal (deprecated - now using message input)
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
    const messageInput = messageInputSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    const colorKey = interaction.values[0];
    session.color = COLOR_PRESETS[colorKey] || 0x5865F2;

    // Show buttons for photo or publish
    const photoButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`post_add_image_${userId}`)
          .setLabel('🖼️ Прикрепить фото')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`post_skip_image_${userId}`)
          .setLabel('✅ Готово')
          .setStyle(ButtonStyle.Success)
      );

    await interaction.reply({ 
      content: `✅ Цвет установлен на **${colorKey}**\n\n🖼️ **Прикрепить фото к посту?**`, 
      components: [photoButton],
      ephemeral: true 
    }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleColorSelect error:', e.message);
  }
}

// Handle add image button
async function handleAddImage(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    const messageInput = messageInputSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    // Set stage to waiting for image message input
    if (messageInput) {
      messageInput.stage = 'waiting_image';
    }

    await interaction.reply({ 
      content: `📤 **Отправь фото в этот канал!**\n\nПосле того как ты отправишь фото, появятся кнопки "Просмотр" и "Опубликовать"`,
      ephemeral: true 
    }).catch(() => null);
  } catch (e) {
    console.error('[POST_MANAGER] handleAddImage error:', e.message);
  }
}

// Handle image URL modal (deprecated - now using message input)
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

    // Show preview and publish buttons
    const controlRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('post_preview')
          .setLabel('👁️ Просмотр')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('post_publish')
          .setLabel('📤 Опубликовать')
          .setStyle(ButtonStyle.Danger)
      );

    session.attachmentUrl = null;
    await interaction.reply({ 
      content: `✅ Готово к публикации!`, 
      components: [controlRow],
      ephemeral: true 
    }).catch(() => null);
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

  return embed;
}

// Build link buttons row
function buildLinkRow() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setURL('https://vihtai.pro/')
        .setLabel('🌐 Наш Сайт')
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setURL('https://t.me/vihtikai')
        .setLabel('📱 Наш телеграмм')
        .setStyle(ButtonStyle.Link)
    );
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
    const linkRow = buildLinkRow();
    await interaction.reply({ embeds: [preview], components: [linkRow], ephemeral: true }).catch(() => null);
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
    const linkRow = buildLinkRow();
    const published = await targetCh.send({ embeds: [embed], components: [linkRow] }).catch(e => {
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
// Handle button to show content input modal
async function handleAskContent(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);

    if (!session) {
      return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);
    }

    console.log('[POST_MANAGER] Показываем модаль содержания');

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
  } catch (e) {
    console.error('[POST_MANAGER] Ошибка handleAskContent:', e.message);
    try {
      await interaction.reply({ content: '❌ Ошибка: ' + e.message, ephemeral: true });
    } catch (replyErr) {
      console.error('[POST_MANAGER] Не удалось отправить ошибку:', replyErr.message);
    }
  }
}

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
  } else if (customId.startsWith('post_ask_content_')) {
    await handleAskContent(interaction);
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

// Handle message input for post creation
async function handlePostMessageInput(message) {
  try {
    if (message.author.bot) return;
    if (message.channelId !== PANEL_CHANNEL_ID) return;

    const userId = message.author.id;
    const messageInput = messageInputSessions.get(userId);
    const session = postSessions.get(userId);

    if (!messageInput || !session) return; // User not in message input mode

    const now = Date.now();
    if (now - messageInput.startTime > 5 * 60 * 1000) {
      // Session expired after 5 minutes
      messageInputSessions.delete(userId);
      return;
    }

    // First message = title
    if (messageInput.stage === 'title') {
      // Process emoji in title
      session.title = await processEmojiInText(message.content, message.client, message.guildId);
      // Save attachment if present
      if (message.attachments.size > 0) {
        session.attachmentUrl = message.attachments.first().url;
      }
      messageInput.stage = 'content';
      
      await message.react('✅');
      const botReply = await message.reply({
        content: `✅ Заголовок: **"${session.title}"**\n\n📝 Теперь напиши **содержание поста**:\n*Подсказка: Анимированные эмодзи должны быть в формате <a:name:id> - просто скопируй их из реакций*`,
        allowedMentions: { repliedUser: false }
      }).catch(() => null);

      // Delete user message after 1 second
      setTimeout(() => {
        message.delete().catch(() => null);
        botReply?.delete().catch(() => null);
      }, 1000);
      return;
    }

    // Second message = content
    if (messageInput.stage === 'content') {
      // Process emoji in content
      session.content = await processEmojiInText(message.content, message.client, message.guildId);
      // Save attachment if present (overwrite previous if needed)
      if (message.attachments.size > 0) {
        session.attachmentUrl = message.attachments.first().url;
      }
      messageInput.stage = 'color';
      
      await message.react('✅');
      
      // Now show color selection
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

      await message.reply({
        content: `✅ Содержание установлено!\n\n🎨 **Выбери цвет:**`,
        components: [colorSelect],
        allowedMentions: { repliedUser: false }
      }).catch(() => null);

      // Delete user message after 1 second (not bot reply - it stays for color selection)
      setTimeout(() => {
        message.delete().catch(() => null);
      }, 1000);
      
      return;
    }

    // Third stage = waiting for photo (if user sends image after color selection)
    if (messageInput.stage === 'waiting_image') {
      if (message.attachments.size > 0) {
        session.attachmentUrl = message.attachments.first().url;
        await message.react('✅');
        
        // Show preview and publish buttons
        const controlRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('post_preview')
              .setLabel('👁️ Просмотр')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('post_publish')
              .setLabel('📤 Опубликовать')
              .setStyle(ButtonStyle.Danger)
          );

        const botReply = await message.reply({
          content: `✅ Фото добавлено к посту!`,
          components: [controlRow],
          allowedMentions: { repliedUser: false }
        }).catch(() => null);
        
        setTimeout(() => {
          message.delete().catch(() => null);
          botReply?.delete().catch(() => null);
        }, 1000);
      }
      return;
    }
  } catch (e) {
    console.error('[POST_MANAGER] handlePostMessageInput error:', e.message);
  }
}

module.exports = {
  postPostManagerPanel,
  handlePostManagerButton,
  handlePostManagerSelect,
  handlePostManagerModal,
  handlePostMessageInput,
  postSessions,
  messageInputSessions
};
