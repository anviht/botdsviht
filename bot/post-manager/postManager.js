const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../libs/db');
const https = require('https');
const http = require('http');

const PANEL_CHANNEL_ID = '1448413112423288903';

// Post sessions
const postSessions = new Map();

// Colors
const COLORS = {
  'red': 0xFF0000, 'green': 0x00FF00, 'blue': 0x0000FF, 'yellow': 0xFFFF00,
  'purple': 0x800080, 'cyan': 0x00FFFF, 'orange': 0xFFA500, 'pink': 0xFF69B4
};

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📝 Менеджер новостей')
    .setDescription('Создавай и публикуй красивые новости')
    .addFields({ name: '⚡ Начни', value: 'Нажми кнопку ниже' })
    .setFooter({ text: 'News Manager v2.0' });
}

function buildControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('post_new').setLabel('➕ Новая новость').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('post_preview').setLabel('👁️ Просмотр').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('post_send').setLabel('📤 Отправить').setStyle(ButtonStyle.Danger)
  );
}

async function postPostManagerPanel(client) {
  try {
    const ch = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!ch) return false;

    const embed = buildPanelEmbed();
    const row = buildControlRow();

    try { await db.ensureReady(); } catch (err) { console.warn('[PM] DB:', err.message); }

    let existing = null;
    try { existing = db.get('postManagerPanel'); } catch (err) { }

    if (existing?.messageId) {
      try {
        const msg = await ch.messages.fetch(existing.messageId).catch(() => null);
        if (msg) { await msg.edit({ embeds: [embed], components: [row] }); return true; }
      } catch (err) { }
    }

    const msg = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (msg) {
      try { await db.set('postManagerPanel', { channelId: ch.id, messageId: msg.id }); } catch (err) { }
      return true;
    }
    return false;
  } catch (e) {
    console.error('[PM] Error:', e.message);
    return false;
  }
}

async function handlePostNew(interaction) {
  try {
    const userId = interaction.user.id;
    postSessions.set(userId, { userId, title: '', content: '', color: 0x5865F2, channel: null, imageUrl: null });

    const channelSelect = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(`pm_channel_${userId}`).setPlaceholder('📌 Выбери канал')
    );

    await interaction.reply({ content: '📌 Выбери канал:', components: [channelSelect], ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] New:', e.message); }
}

async function handleChannelSelect(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);

    session.channel = interaction.values[0];

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pm_title_btn_${userId}`).setLabel('📝 Вперёд').setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ 
      content: `✅ Канал <#${session.channel}> выбран!\n\n👇 Нажми кнопку чтобы заполнить заголовок`, 
      components: [button],
      ephemeral: true 
    }).catch(() => null);
  } catch (e) { console.error('[PM] Channel:', e.message); }
}

async function handleTitleButton(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return;

    const modal = new ModalBuilder()
      .setCustomId(`pm_title_${userId}`)
      .setTitle('📝 Заголовок')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Заголовок новости').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );

    await interaction.showModal(modal);
  } catch (e) { console.error('[PM] TitleBtn:', e.message); }
}

async function handleTitleModal(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);

    session.title = interaction.fields.getTextInputValue('title');

    const modal = new ModalBuilder()
      .setCustomId(`pm_content_${userId}`)
      .setTitle('📄 Содержание')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('content').setLabel('Текст новости').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );

    await interaction.showModal(modal);
  } catch (e) { console.error('[PM] Title:', e.message); }
}

async function handleContentModal(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return await interaction.reply({ content: '❌ Сессия потеряна', ephemeral: true }).catch(() => null);

    session.content = interaction.fields.getTextInputValue('content');

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pm_color_${userId}`).setLabel('🎨 Цвет').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pm_image_${userId}`).setLabel('🖼️ Фото').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pm_preview_${userId}`).setLabel('👁️ Просмотр').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pm_send_${userId}`).setLabel('📤 Отправить').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ content: '✅ Готово!\n\n🎨 Выбери цвет, добавь фото или отправляй:', components: [actionRow], ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] Content:', e.message); }
}

async function handleColorSelect(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return;

    const colorSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`pm_color_menu_${userId}`).setPlaceholder('🎨 Выбери цвет')
        .addOptions(
          { label: '🔴 Красный', value: 'red' },
          { label: '🟢 Зелёный', value: 'green' },
          { label: '🔵 Синий', value: 'blue' },
          { label: '🟡 Жёлтый', value: 'yellow' },
          { label: '🟣 Фиолетовый', value: 'purple' },
          { label: '🔷 Голубой', value: 'cyan' },
          { label: '🟠 Оранжевый', value: 'orange' },
          { label: '🩷 Розовый', value: 'pink' }
        )
    );

    await interaction.reply({ content: '🎨 Выбери цвет:', components: [colorSelect], ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] Color:', e.message); }
}

async function handleColorMenu(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return;

    const colorKey = interaction.values[0];
    session.color = COLORS[colorKey] || 0x5865F2;

    await interaction.reply({ content: `✅ Цвет установлен: **${colorKey}**`, ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] ColorMenu:', e.message); }
}

async function handleImageButton(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session) return;

    await interaction.reply({ content: '📸 Отправь фото в этот чат\n\n*Оно автоматически добавится к новости*', ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] Image:', e.message); }
}

async function handleImageMessage(message) {
  try {
    if (message.author.bot) return;
    if (message.channelId !== PANEL_CHANNEL_ID) return;

    const userId = message.author.id;
    const session = postSessions.get(userId);
    if (!session) return;

    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      session.imageUrl = attachment.url;
      await message.react('✅');
      await message.reply({ content: '✅ Фото добавлено!', allowedMentions: { repliedUser: false } }).catch(() => null);
      setTimeout(() => { message.delete().catch(() => null); }, 2000);
    }
  } catch (e) { console.error('[PM] ImageMsg:', e.message); }
}

async function handlePreview(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session || !session.title || !session.content) {
      return await interaction.reply({ content: '❌ Заполни заголовок и содержание', ephemeral: true }).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(session.color)
      .setTitle(session.title)
      .setDescription(session.content);

    if (session.imageUrl) {
      embed.setImage(session.imageUrl);
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setURL('https://vihtai.pro/').setLabel('🌐 Сайт').setStyle(ButtonStyle.Link),
      new ButtonBuilder().setURL('https://t.me/vihtikai').setLabel('📱 Телеграмм').setStyle(ButtonStyle.Link)
    );

    await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true }).catch(() => null);
  } catch (e) { console.error('[PM] Preview:', e.message); }
}

async function handleSend(interaction) {
  try {
    const userId = interaction.user.id;
    const session = postSessions.get(userId);
    if (!session || !session.title || !session.content || !session.channel) {
      return await interaction.reply({ content: '❌ Данные неполные', ephemeral: true }).catch(() => null);
    }

    const ch = await interaction.client.channels.fetch(session.channel).catch(() => null);
    if (!ch) {
      return await interaction.reply({ content: '❌ Канал не найден', ephemeral: true }).catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(session.color)
      .setTitle(session.title)
      .setDescription(session.content);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setURL('https://vihtai.pro/').setLabel('🌐 Сайт').setStyle(ButtonStyle.Link),
      new ButtonBuilder().setURL('https://t.me/vihtikai').setLabel('📱 Телеграмм').setStyle(ButtonStyle.Link)
    );

    const messageOptions = { embeds: [embed], components: [buttons] };

    // Download and attach image if present
    if (session.imageUrl) {
      try {
        const imageBuffer = await downloadImage(session.imageUrl);
        messageOptions.files = [{ attachment: imageBuffer, name: 'news.png' }];
        embed.setImage('attachment://news.png');
      } catch (err) {
        console.warn('[PM] Image download failed:', err.message);
      }
    }

    const sent = await ch.send(messageOptions).catch(e => {
      console.error('[PM] Send error:', e.message);
      return null;
    });

    if (sent) {
      postSessions.delete(userId);
      await interaction.reply({ content: `✅ Новость отправлена в <#${session.channel}>!`, ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: '❌ Ошибка отправки', ephemeral: true }).catch(() => null);
    }
  } catch (e) { console.error('[PM] Send:', e.message); }
}

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function handlePostManagerButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'post_new') await handlePostNew(interaction);
  else if (customId === 'post_preview') await handlePreview(interaction);
  else if (customId === 'post_send') await handleSend(interaction);
  else if (customId.startsWith('pm_title_btn_')) await handleTitleButton(interaction);
  else if (customId.startsWith('pm_color_') && !customId.includes('menu')) await handleColorSelect(interaction);
  else if (customId.startsWith('pm_image_')) await handleImageButton(interaction);
  else if (customId.startsWith('pm_preview_')) await handlePreview(interaction);
  else if (customId.startsWith('pm_send_')) await handleSend(interaction);
}

async function handlePostManagerSelect(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('pm_channel_')) await handleChannelSelect(interaction);
  else if (customId.startsWith('pm_color_menu_')) await handleColorMenu(interaction);
}

async function handlePostManagerModal(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('pm_title_')) await handleTitleModal(interaction);
  else if (customId.startsWith('pm_content_')) await handleContentModal(interaction);
}

async function handlePostMessageInput(message) {
  await handleImageMessage(message);
}

module.exports = {
  postPostManagerPanel,
  handlePostManagerButton,
  handlePostManagerSelect,
  handlePostManagerModal,
  handlePostMessageInput
};
