const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
  aiChatChannelId: process.env.AI_CHAT_CHANNEL_ID || '1437189999882801173',
  announceChannelId: process.env.ANNOUNCE_CHANNEL_ID || '1436487981723680930',
  musicLogChannelId: process.env.MUSIC_LOG_CHANNEL_ID || process.env.ANNOUNCE_CHANNEL_ID || '1436487981723680930',
  useMockAi: process.env.USE_MOCK_AI === 'true',
  guildMembersIntent: process.env.GUILD_MEMBERS_INTENT === 'true',
  messageContentIntent: process.env.MESSAGE_CONTENT_INTENT === 'true'
};

module.exports = config;

// Администраторские роли (комма-разделённый список в env или дефолтные две роли)
const adminRoleEnv = process.env.ADMIN_ROLE_IDS || '1436485697392607303,1436486253066326067';
config.adminRoles = adminRoleEnv.split(',').map(s => s.trim()).filter(Boolean);
