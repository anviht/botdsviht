const db = require('../libs/db');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { safeUpdate } = require('../libs/interactionUtils');

const MENU_KEY = 'menuPanelPosted';
const MENU_CHANNEL_ID = '1445738068337496074';

function makeMainEmbed() {
  return new EmbedBuilder()
    .setTitle('🧭 Навигация по Discord серверу Viht')
    .setColor(0x6a5acd)
    .setDescription('Добро пожаловать! Здесь удобная навигация по важным каналам и возможностям сервера. Нажмите кнопку, чтобы открыть раздел — сообщение обновится на месте.')
    .addFields(
      { name: 'Правила', value: 'Коротко о правилах поведения на сервере.', inline: true },
      { name: 'Новости', value: 'Последние объявления и обновления.', inline: true },
      { name: 'Общение', value: 'Чат для общения и обсуждений.', inline: true }
    )
    .setFooter({ text: 'Все ссылки и управление — прямо из этого меню.' });
}

function mainRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu_rules').setLabel('📜 Правила').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_news').setLabel('📰 Новости').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('menu_chat').setLabel('💬 Общение').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu_ai').setLabel('🤖 Инструкция по ИИ').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_gallery').setLabel('🖼️ Галерея').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_vihtapi').setLabel('🔗 viht-api').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu_suggestions').setLabel('💡 Предложения').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_price').setLabel('💲 Прайс/Заказать бота').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('menu_music').setLabel('🎧 Запустить радио/музыку').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('menu_support').setLabel('🛠️ Поддержка').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setURL('https://vihtai.pro').setLabel('🔐 Подключить VPN (vihtai.pro)').setStyle(ButtonStyle.Link)
    )
  ];
}

async function ensureMenuPanel(client) {
  try {
    if (!client) return;
    const ch = await client.channels.fetch(MENU_CHANNEL_ID).catch(() => null);
    if (!ch) return console.warn('Menu channel not found:', MENU_CHANNEL_ID);
    const rec = db.get(MENU_KEY);
    const embed = makeMainEmbed();
    const rows = mainRow();
    if (rec && rec.channelId === MENU_CHANNEL_ID && rec.messageId) {
      const existing = await ch.messages.fetch(rec.messageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components: rows }).catch(() => null);
        console.log('Updated existing menu panel');
        return;
      }
    }
    const msg = await ch.send({ embeds: [embed], components: rows }).catch(() => null);
    if (msg && db && db.set) await db.set(MENU_KEY, { channelId: MENU_CHANNEL_ID, messageId: msg.id, postedAt: Date.now() });
    console.log('Posted new menu panel to', MENU_CHANNEL_ID);
  } catch (e) { console.error('ensureMenuPanel error', e && e.message ? e.message : e); }
}

function makeBackRow() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('menu_main').setLabel('◀️ Назад').setStyle(ButtonStyle.Secondary))];
}

async function handleMenuButton(interaction) {
  try {
    const id = interaction.customId;
    // Build views
    if (id === 'menu_main') {
      await safeUpdate(interaction, { embeds: [makeMainEmbed()], components: mainRow() });
      return;
    }

    if (id === 'menu_rules') {
      const e = new EmbedBuilder().setTitle('📜 Правила сообщества').setColor(0xffc107).setDescription('Ознакомьтесь с полными правилами по ссылке ниже. Пожалуйста, уважайте других участников.');
      e.addFields({ name: 'Ссылка', value: '[Правила](https://discord.com/channels/1428051812103094282/1436487842334507058)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_news') {
      const e = new EmbedBuilder().setTitle('📰 Новости сервера').setColor(0x00aced).setDescription('Свежие объявления и релизы. Следите за обновлениями!');
      e.addFields({ name: 'Ссылка', value: '[Новости](https://discord.com/channels/1428051812103094282/1436487931081523384)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_chat') {
      const e = new EmbedBuilder().setTitle('💬 Общение').setColor(0x2ecc71).setDescription('Здесь можно просто общаться, делиться идеями и знакомиться с другими участниками.');
      e.addFields({ name: 'Ссылка', value: '[Общение](https://discord.com/channels/1428051812103094282/1437190736649916456)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_ai') {
      const e = new EmbedBuilder().setTitle('🤖 Инструкция по использованию ИИ').setColor(0x9b59b6).setDescription('Использовать ИИ могут участники с ролью **Пользователь**.\n\nКак это работает:\n1) Нажмите «Начать чат», бот создаст приватную ветку (thread) видимую только вам и роли модераторов.\n2) В ветке вы общаетесь с ИИ — создавайте новые сообщения, ИИ отвечает в ту же ветку.\n3) Управление: закрыть ветку, удалить историю или создать новую — доступны в кнопках ИИ.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setURL('https://discord.com/channels/1428051812103094282/1437189999882801173').setLabel('Начать чат').setStyle(ButtonStyle.Link),
        new ButtonBuilder().setCustomId('menu_main').setLabel('◀️ Назад').setStyle(ButtonStyle.Secondary)
      );
      await safeUpdate(interaction, { embeds: [e], components: [row] });
      return;
    }

    if (id === 'menu_gallery') {
      const e = new EmbedBuilder().setTitle('🖼️ Галерея работ').setColor(0xf39c12).setDescription('Фотографии, примеры работ и вдохновение. Доступно для роли **Пользователь**.');
      e.addFields({ name: 'Ссылка', value: '[Галерея](https://discord.com/channels/1428051812103094282/1437190052638888036)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_vihtapi') {
      const e = new EmbedBuilder().setTitle('🔗 viht-api и интеграции').setColor(0x3498db).setDescription('Информация о интеграции ИИ, VPN, Telegram и сайте.' );
      e.addFields({ name: 'Ссылка', value: '[viht-api](https://discord.com/channels/1428051812103094282/1437190113187594322)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_suggestions') {
      const e = new EmbedBuilder().setTitle('💡 Канал предложений').setColor(0x1abc9c).setDescription('Делитесь идеями по улучшению бота и сервера. Писать могут пользователи с ролью **Пользователь**.');
      e.addFields({ name: 'Ссылка', value: '[Предложения](https://discord.com/channels/1428051812103094282/1437190638071447644)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_price') {
      const e = new EmbedBuilder().setTitle('💲 Прайс / Заказать бота').setColor(0xe67e22).setDescription('Хотите такого же бота? Здесь описаны условия и цены.');
      e.addFields({ name: 'Ссылка', value: '[Прайс / Заказать](https://discord.com/channels/1428051812103094282/1443194062269321357)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_music') {
      const e = new EmbedBuilder().setTitle('🎧 Радио и музыка в голосе').setColor(0x8e44ad).setDescription('Управление запуском радио и собственной музыки доступно в панели.');
      e.addFields({ name: 'Ссылка', value: '[Панель управления музыкой](https://discord.com/channels/1428051812103094282/1443194196172476636)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    if (id === 'menu_support') {
      const e = new EmbedBuilder().setTitle('🛠️ Поддержка Viht').setColor(0xcc0000).setDescription('Если нужна помощь — создайте обращение в службе поддержки.');
      e.addFields({ name: 'Ссылка', value: '[Поддержка](https://discord.com/channels/1428051812103094282/1442575929044897792)' });
      await safeUpdate(interaction, { embeds: [e], components: makeBackRow() });
      return;
    }

    // Fallback: go back to main
    await safeUpdate(interaction, { embeds: [makeMainEmbed()], components: mainRow() });
  } catch (e) {
    console.error('handleMenuButton error', e && e.message ? e.message : e);
    try { await safeUpdate(interaction, { content: 'Ошибка при навигации.', components: [] }); } catch (er) {}
  }
}

module.exports = { ensureMenuPanel, handleMenuButton };
