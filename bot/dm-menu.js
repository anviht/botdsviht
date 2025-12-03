const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Creates main navigation embed for DM menu
 */
function createMainMenuEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🤖 Меню бота Viht')
    .setDescription(`Привет, ${user.username}! 👋\n\nВыбери опцию для управления ботом:`)
    .addFields(
      { name: '🎵 Музыка', value: 'Управление плейлистами, избранным и историей', inline: false },
      { name: '👤 Профиль', value: 'Просмотр статистики и достижений', inline: false },
      { name: '📚 Справка', value: 'Помощь по командам бота', inline: false },
      { name: '⚙️ Сервер', value: 'Информация о сервере и ссылки', inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: 'Это меню автоматически обновляется каждый час' });
}

/**
 * Creates navigation buttons for main menu
 */
function createMainMenuButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dm_menu_music')
      .setLabel('🎵 Музыка')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm_menu_profile')
      .setLabel('👤 Профиль')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm_menu_help')
      .setLabel('📚 Справка')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('dm_menu_server')
      .setLabel('⚙️ Сервер')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Creates back button row
 */
function createBackButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dm_menu_back')
      .setLabel('← Назад')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Create DM menu for user
 */
async function createUserMenu(client, userId, guildId = null) {
  try {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;

    const embed = createMainMenuEmbed(user);
    const buttons = createMainMenuButtons();

    const message = await dmChannel.send({
      embeds: [embed],
      components: [buttons]
    }).catch(e => {
      console.error('Failed to send DM menu:', e.message);
      return null;
    });

    return message;
  } catch (err) {
    console.error('createUserMenu error:', err.message);
  }
}

/**
 * Handle DM menu button interactions
 */
async function handleDMMenuButton(interaction) {
  const { customId, user, client } = interaction;

  if (customId === 'dm_menu_back') {
    const embed = createMainMenuEmbed(user);
    const buttons = createMainMenuButtons();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_music') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Музыка')
      .setDescription('Управление вашей музыкальной библиотекой:')
      .addFields(
        { name: '📋 История', value: 'Последние прослушанные треки', inline: false },
        { name: '❤️ Избранное', value: 'Ваши любимые песни', inline: false },
        { name: '🎼 Плейлисты', value: 'Созданные плейлисты', inline: false }
      )
      .setColor(0x1DB954)
      .setFooter({ text: 'Используйте команду /music_library на сервере для полного управления' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  // Open lounge player in DM
  if (customId === 'dm_menu_lounge') {
    // create lounge player embed with controls
    await openLoungePlayer(user, client, interaction);
    return;
  }

  if (customId === 'dm_menu_profile') {
    const embed = new EmbedBuilder()
      .setTitle('👤 Профиль')
      .setDescription('Информация о вашем профиле:')
      .addFields(
        { name: '📊 Статистика', value: 'Активность, достижения и репутация', inline: false },
        { name: '🏆 Достижения', value: 'Полный список ваших достижений', inline: false }
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'Используйте команду /profile на сервере для полной информации' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_help') {
    const embed = new EmbedBuilder()
      .setTitle('📚 Справка')
      .setDescription('Основные команды бота:')
      .addFields(
        { name: '/music', value: 'Управление музыкой на сервере', inline: false },
        { name: '/profile', value: 'Просмотр вашего профиля', inline: false },
        { name: '/music_library', value: 'Управление библиотекой музыки', inline: false },
        { name: '/support', value: 'Создать тикет поддержки', inline: false },
        { name: '/help', value: 'Полный список команд', inline: false }
      )
      .setColor(0x2C3E50)
      .setFooter({ text: 'Для более подробной информации используйте /help на сервере' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }

  if (customId === 'dm_menu_server') {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Сервер')
      .setDescription('Информация о сервере и ссылки:')
      .addFields(
        { name: '🔗 Основной сервер', value: 'https://discord.gg/viht', inline: false },
        { name: '📢 Объявления', value: 'Следите за каналом объявлений для важной информации', inline: false },
        { name: '💬 Чат', value: 'Участвуйте в обсуждениях сообщества', inline: false }
      )
      .setColor(0x7289DA)
      .setFooter({ text: 'Спасибо за использование бота Viht!' });

    const buttons = createBackButton();
    await interaction.update({ embeds: [embed], components: [buttons] }).catch(() => {});
    return;
  }
}

/**
 * Cleanup old DM menu messages for user
 * Keeps only the most recent menu message
 */
async function cleanupOldMenuMessages(user, client) {
  try {
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;

    // Fetch recent messages from DM channel
    const messages = await dmChannel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return;

    // Find bot's menu messages (with "Меню бота Viht" or DM menu buttons)
    const menuMessages = messages.filter(msg => {
      if (msg.author.id !== client.user.id) return false;
      // Check if message has DM menu buttons or main menu embed
      return msg.components.some(row =>
        row.components.some(comp =>
          comp.customId && comp.customId.startsWith('dm_menu_')
        )
      ) || (msg.embeds && msg.embeds[0] && msg.embeds[0].title === '🤖 Меню бота Viht');
    });

    // Keep only the most recent one
    const sortedMessages = Array.from(menuMessages.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    const messagesToDelete = sortedMessages.slice(1); // Keep first, delete rest

    for (const msg of messagesToDelete) {
      await msg.delete().catch(() => {});
    }

    return sortedMessages.length;
  } catch (err) {
    console.error('cleanupOldMenuMessages error:', err.message);
  }
}

module.exports = {
  createUserMenu,
  handleDMMenuButton,
  cleanupOldMenuMessages,
  createMainMenuEmbed,
  createMainMenuButtons,
  createBackButton
};

// Lounge player: create DM lounge embed and controls
async function openLoungePlayer(user, client, interaction) {
  try {
    const dm = await user.createDM().catch(() => null);
    if (!dm) return;
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🎧 Lounge Player')
      .setDescription('Управление музыкой в личных сообщениях. Текущая песня и очередь отображаются здесь.')
      .setColor(0x1DB954);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dm_lounge_pause').setLabel('⏸ Пауза').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_lounge_skip').setLabel('⏭ Пропустить').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dm_lounge_repeat').setLabel('🔁 Повтор').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dm_lounge_close').setLabel('✖ Закрыть').setStyle(ButtonStyle.Danger)
    );

    await dm.send({ embeds: [embed], components: [row] }).catch(() => {});
    if (interaction && interaction.deferred) await interaction.update({ content: 'Открыл Lounge Player в ЛС.', embeds: [], components: [] }).catch(() => {});
  } catch (err) {
    console.error('openLoungePlayer error:', err.message);
  }
}

