const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  dashboardPort: process.env.PORT || 3001,
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
  aiChatChannelId: process.env.AI_CHAT_CHANNEL_ID || '1437189999882801173',
  announceChannelId: process.env.ANNOUNCE_CHANNEL_ID || '1436487981723680930',
  musicLogChannelId: process.env.MUSIC_LOG_CHANNEL_ID || process.env.ANNOUNCE_CHANNEL_ID || '1436487981723680930',
  useMockAi: process.env.USE_MOCK_AI === 'true',
  guildMembersIntent: process.env.GUILD_MEMBERS_INTENT === 'true',
  messageContentIntent: process.env.MESSAGE_CONTENT_INTENT === 'true'
};

module.exports = config;
