const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const db = require('../libs/db');

const REVIEWS_CHANNEL_ID = '1449758856682017001'; // Канал с панелью отзывов
const ADMIN_REVIEW_CHANNEL_ID = '1446801265219604530'; // Канал для проверки
const VOICE_CHANNEL_ID = '1449757724274589829'; // Голосовой канал
const ALLOWED_ROLE_ID = '1436485697392607303';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reviews')
    .setDescription('🔧 Установить панель отзывов (админ)'),

  async execute(interaction) {
    // Проверка роли
    const member = interaction.member;
    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return await interaction.reply({
        content: '❌ У тебя нет прав для этой команды!',
        ephemeral: true
      });
    }

    // Получаем канал отзывов
    const reviewsChannel = interaction.options.getChannel?.('channel') || interaction.channel;
    
    if (!reviewsChannel || !reviewsChannel.isTextBased()) {
      return await interaction.reply({
        content: '❌ Укажи текстовый канал!',
        ephemeral: true
      });
    }

    // Создаём панель
    const embed = new EmbedBuilder()
      .setTitle('📝 Отзывы о Viht VPN')
      .setDescription('Поделись своим мнением о нашем сервисе!')
      .setColor(0xFF006E)
      .addFields(
        { name: '💬 Оставить отзыв', value: 'Нажми кнопку ниже, чтобы поделиться своим мнением', inline: false },
        { name: '⭐ Просмотреть отзывы', value: 'Смотри что думают другие пользователи', inline: false }
      );

    const leaveReviewBtn = new ButtonBuilder()
      .setCustomId('review_leave')
      .setLabel('Оставить отзыв')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝');

    const viewReviewsBtn = new ButtonBuilder()
      .setCustomId('review_view')
      .setLabel('Смотреть отзывы')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⭐');

    const row = new ActionRowBuilder().addComponents(leaveReviewBtn, viewReviewsBtn);

    await reviewsChannel.send({
      embeds: [embed],
      components: [row]
    });

    await interaction.reply({
      content: `✅ Панель отзывов создана в ${reviewsChannel}`,
      ephemeral: true
    });
  }
};

// Обработчик кнопок
module.exports.handleButton = async (interaction) => {
  if (!interaction.customId.startsWith('review_')) return;

  try {
    if (interaction.customId === 'review_leave') {
      const modal = new ModalBuilder()
        .setCustomId('review_submit_modal')
        .setTitle('Оставить отзыв');

      const reviewInput = new TextInputBuilder()
        .setCustomId('review_text')
        .setLabel('Твой отзыв')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Напиши своё мнение о Viht VPN...')
        .setMinLength(10)
        .setMaxLength(2000)
        .setRequired(true);

      const ratingInput = new TextInputBuilder()
        .setCustomId('review_rating')
        .setLabel('Оценка (1-5 звёзд)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('От 1 до 5')
        .setMinLength(1)
        .setMaxLength(1)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reviewInput),
        new ActionRowBuilder().addComponents(ratingInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'review_view') {
      await db.ensureReady();
      const allReviews = db.get('reviews') || { approved: [] };
      const approved = allReviews.approved || [];

      if (approved.length === 0) {
        return await interaction.reply({
          content: '❌ Одобренных отзывов ещё нет',
          ephemeral: true
        });
      }

      const embeds = [];
      for (let i = 0; i < Math.min(approved.length, 5); i++) {
        const review = approved[i];
        const user = await interaction.client.users.fetch(review.userId).catch(() => null);
        const stars = '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

        const embed = new EmbedBuilder()
          .setColor(0xFF006E)
          .setAuthor({ name: user ? user.username : 'Unknown User', iconURL: user?.displayAvatarURL() })
          .setDescription(review.text)
          .addFields({ name: 'Оценка', value: stars, inline: false })
          .setFooter({ text: `${i + 1}/${approved.length}` });

        embeds.push(embed);
      }

      await interaction.reply({
        embeds: [embeds[0]],
        ephemeral: true
      });
      return;
    }
  } catch (error) {
    console.error('Review button error:', error);
    await interaction.reply({
      content: `❌ Ошибка: ${error.message}`,
      ephemeral: true
    }).catch(() => {});
  }
};

// Обработчик модалей
module.exports.handleModal = async (interaction) => {
  if (interaction.customId !== 'review_submit_modal') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const reviewText = interaction.fields.getTextInputValue('review_text');
    const rating = parseInt(interaction.fields.getTextInputValue('review_rating'), 10);

    // Валидация оценки
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return await interaction.editReply({
        content: '❌ Оценка должна быть от 1 до 5'
      });
    }

    // Проверяем, есть ли уже отзыв от этого пользователя
    await db.ensureReady();
    const allReviews = db.get('reviews') || { approved: [] };
    const userReviewExists = (allReviews.approved || []).some(r => r.userId === interaction.user.id);
    
    if (userReviewExists) {
      return await interaction.editReply({
        content: '⚠️ Вы уже опубликовали отзыв. Один пользователь - один отзыв.\n\nПримечание: Удалить или изменить отзыв нельзя, так как это конечный результат.'
      });
    }

    // Сохраняем черновик в БД
    const pendingReviews = db.get('pending_reviews') || {};
    const reviewId = `review_${interaction.user.id}_${Date.now()}`;
    
    pendingReviews[reviewId] = {
      userId: interaction.user.id,
      username: interaction.user.username,
      text: reviewText,
      rating: rating,
      createdAt: new Date().toISOString()
    };
    
    await db.set('pending_reviews', pendingReviews);

    // Отправляем админам на проверку
    const adminChannel = await interaction.client.channels.fetch(ADMIN_REVIEW_CHANNEL_ID).catch(() => null);
    if (adminChannel) {
      const adminEmbed = new EmbedBuilder()
        .setTitle('🔍 Новый отзыв на проверку')
        .setColor(0xFFAA00)
        .addFields(
          { name: 'От пользователя', value: `${interaction.user.toString()} (${interaction.user.username})` },
          { name: 'ID', value: interaction.user.id },
          { name: 'Оценка', value: '⭐'.repeat(rating) + '☆'.repeat(5 - rating) },
          { name: 'Отзыв', value: reviewText }
        )
        .setFooter({ text: `ID: ${reviewId}` });

      const approveBtn = new ButtonBuilder()
        .setCustomId(`review_approve_${reviewId}`)
        .setLabel('✅ Принять')
        .setStyle(ButtonStyle.Success);

      const rejectBtn = new ButtonBuilder()
        .setCustomId(`review_reject_${reviewId}`)
        .setLabel('❌ Отказать')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

      await adminChannel.send({
        embeds: [adminEmbed],
        components: [row]
      });
    }

    await interaction.editReply({
      content: '✅ Спасибо за отзыв! Он отправлен на проверку администратору.'
    });

  } catch (error) {
    console.error('Review modal error:', error);
    await interaction.editReply({
      content: `❌ Ошибка: ${error.message}`
    });
  }
};

// Функция для обновления названия канала с количеством отзывов
async function updateVoiceChannelName(client) {
  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!voiceChannel) {
      console.warn('[Reviews] Voice channel not found for name update');
      return;
    }

    await db.ensureReady();
    const allReviews = db.get('reviews') || { approved: [] };
    const reviewCount = (allReviews.approved || []).length;
    
    const newName = `🤝 Отзывы  - ${reviewCount}`;
    console.log(`[Reviews] Attempting to update channel name. Current: "${voiceChannel.name}", Target: "${newName}"`);
    
    if (voiceChannel.name !== newName) {
      await voiceChannel.setName(newName).catch(err => {
        console.warn('[Reviews] Could not update channel name:', err.message);
      });
      console.log(`[Reviews] ✅ Updated channel name to: ${newName}`);
    } else {
      console.log(`[Reviews] Channel name already correct: ${newName}`);
    }
  } catch (error) {
    console.error('[Reviews] Error updating voice channel name:', error);
  }
}

// Обработчик кнопок принять/отказать
module.exports.handleReviewButton = async (interaction) => {
  const customId = interaction.customId;
  if (!customId.startsWith('review_approve_') && !customId.startsWith('review_reject_')) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const reviewId = customId.replace('review_approve_', '').replace('review_reject_', '');
    
    await db.ensureReady();
    const pendingReviews = db.get('pending_reviews') || {};
    const review = pendingReviews[reviewId];

    if (!review) {
      return await interaction.editReply({
        content: '❌ Отзыв не найден'
      });
    }

    const user = await interaction.client.users.fetch(review.userId).catch(() => null);

    if (customId.startsWith('review_approve_')) {
      // Одобренный отзыв
      const allReviews = db.get('reviews') || { approved: [] };
      if (!Array.isArray(allReviews.approved)) allReviews.approved = [];
      
      // Проверяем не есть ли уже отзыв от этого пользователя
      const userReviewExists = allReviews.approved.some(r => r.userId === review.userId);
      if (userReviewExists) {
        return await interaction.editReply({
          content: '⚠️ У этого пользователя уже есть опубликованный отзыв. Один пользователь - один отзыв.'
        });
      }
      
      allReviews.approved.push({
        userId: review.userId,
        text: review.text,
        rating: review.rating,
        approvedAt: new Date().toISOString()
      });

      await db.set('reviews', allReviews);

      // Отправляем в канал голосовых каналов
      const voiceChannel = await interaction.client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
      if (voiceChannel && voiceChannel.isTextBased()) {
        const reviewEmbed = new EmbedBuilder()
          .setColor(0xFF006E)
          .setAuthor({ name: review.username, iconURL: user?.displayAvatarURL() })
          .setDescription(review.text)
          .addFields({ name: 'Оценка', value: '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating) })
          .setFooter({ text: 'Одобренный отзыв' });

        await voiceChannel.send({ embeds: [reviewEmbed] });
      }

      // Обновляем название канала с новым количеством отзывов
      await updateVoiceChannelName(interaction.client);

      // Уведомляем пользователя
      if (user) {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('✅ Ваш отзыв опубликован!')
              .setDescription('Спасибо за вашу оценку Viht VPN')
              .setColor(0x2ECC71)
          ]
        }).catch(() => {});
      }

      await interaction.editReply({
        content: `✅ Отзыв принят и опубликован`
      });

    } else {
      // Отказанный отзыв
      if (user) {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ Отзыв отклонен')
              .setDescription('К сожалению, ваш отзыв не прошел модерацию.\n\nПожалуйста, убедитесь что отзыв соответствует правилам сообщества.')
              .setColor(0xe74c3c)
          ]
        }).catch(() => {});
      }

      await interaction.editReply({
        content: `✅ Отзыв отклонен, пользователю отправлено уведомление`
      });
    }

    // Удаляем из ожидающих
    delete pendingReviews[reviewId];
    await db.set('pending_reviews', pendingReviews);

    // Удаляем исходное сообщение
    await interaction.message.delete().catch(() => {});

  } catch (error) {
    console.error('Review button error:', error);
    await interaction.editReply({
      content: `❌ Ошибка: ${error.message}`
    });
  }
};

// Функция для подключения бота к голосовому каналу
module.exports.connectToVoiceChannel = async (client) => {
  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      console.warn('[Reviews] Voice channel not found or not voice channel');
      return;
    }

    try {
      const connection = joinVoiceChannel({
        channelId: VOICE_CHANNEL_ID,
        guildId: voiceChannel.guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true
      });

      console.log('[Reviews] Bot connected to voice channel for reviews system');
    } catch (err) {
      console.warn('[Reviews] Could not join voice channel:', err.message);
    }

    // Обновляем название канала при подключении
    await updateVoiceChannelName(client);

  } catch (error) {
    console.error('[Reviews] Error connecting to voice channel:', error);
  }
};

// Функция для создания/обновления панели отзывов
module.exports.ensureReviewsPanel = async (client) => {
  try {
    await db.ensureReady();
    
    const channel = await client.channels.fetch(REVIEWS_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn('[Reviews] Reviews channel not found');
      return;
    }

    // Проверяем есть ли уже панель в БД
    let reviewsPanelId = db.get('reviews_panel_id');

    // Если панель записана в БД, пытаемся получить её
    if (reviewsPanelId) {
      try {
        const existingMessage = await channel.messages.fetch(reviewsPanelId).catch(() => null);
        if (existingMessage) {
          console.log('[Reviews] Reviews panel already exists, skipping creation');
          return;
        }
      } catch (e) {
        console.warn('[Reviews] Existing panel message not found, creating new one');
      }
    }

    // Создаём новую панель
    const embed = new EmbedBuilder()
      .setTitle('📝 Отзывы о Viht VPN')
      .setDescription('Поделись своим мнением о нашем сервисе!')
      .setColor(0xFF006E)
      .addFields(
        { name: '💬 Оставить отзыв', value: 'Нажми кнопку ниже, чтобы поделиться своим мнением', inline: false },
        { name: '⭐ Просмотреть отзывы', value: 'Смотри что думают другие пользователи', inline: false }
      );

    const leaveReviewBtn = new ButtonBuilder()
      .setCustomId('review_leave')
      .setLabel('Оставить отзыв')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝');

    const viewReviewsBtn = new ButtonBuilder()
      .setCustomId('review_view')
      .setLabel('Смотреть отзывы')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⭐');

    const row = new ActionRowBuilder().addComponents(leaveReviewBtn, viewReviewsBtn);

    const message = await channel.send({
      embeds: [embed],
      components: [row]
    });

    // Сохраняем ID панели в БД
    await db.set('reviews_panel_id', message.id);
    console.log('[Reviews] Reviews panel created and saved:', message.id);

    // Обновляем название канала с текущим количеством отзывов
    await updateVoiceChannelName(client);

  } catch (error) {
    console.error('[Reviews] Error ensuring reviews panel:', error);
  }
};
// Обработчик удаления сообщения отзыва - обновляет счетчик
module.exports.handleReviewDeleted = async (message, guild, client) => {
  try {
    // Проверяем что это сообщение от бота (отзыв)
    if (!message.author || !message.author.bot) {
      return; // Игнорируем сообщения от пользователей
    }
    
    // Проверяем что это embed отзыва
    if (!message.embeds || message.embeds.length === 0) {
      return; // Игнорируем сообщения без embeds
    }
    
    const embed = message.embeds[0];
    if (!embed.title || !embed.title.includes('Отзыв')) {
      return; // Не отзыв
    }
    
    console.log('[Reviews] 🗑️ Отзыв удалён, пересчитываем количество');
    
    // Пересчитываем количество одобренных отзывов
    await db.ensureReady();
    const allReviews = db.get('reviews') || { approved: [] };
    const reviewCount = (allReviews.approved || []).length;
    
    // Обновляем название канала
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (voiceChannel && voiceChannel.isVoiceBased?.()) {
      const newName = `🤝 Отзывы  - ${reviewCount}`;
      
      if (voiceChannel.name !== newName) {
        try {
          await voiceChannel.setName(newName);
          console.log(`[Reviews] ✅ Обновлено название канала на: ${newName}`);
        } catch (err) {
          console.warn('[Reviews] Ошибка при обновлении названия:', err?.message);
        }
      }
    }
    
  } catch (error) {
    console.error('[Reviews] Error handling review deletion:', error);
  }
};