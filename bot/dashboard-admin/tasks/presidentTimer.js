// President timer — проверка срока президента и триггер переизбрания
const db = require('../../libs/db');
const presidentModel = require('../models/presidentModel');

async function startPresidentTimer(client) {
  setInterval(async () => {
    try {
      const presData = db.get('president');
      if (!presData) return;

      if (presidentModel.isPresidentTermExpired()) {
        console.log('[PresidentTimer] Term expired, removing role and triggering reelection');
        
        const guild = await client.guilds.fetch(process.env.GUILD_ID || '1428051812103094282').catch(() => null);
        if (!guild) return;

        // Remove president role
        await presidentModel.removePresidentRole(guild);

        // Clear president data
        if (db && db.set) await db.set('president', null);

        // Notify panel channel
        const panelChannel = await client.channels.fetch('1443194196172476636').catch(() => null);
        if (panelChannel) {
          await panelChannel.send({
            content: '@everyone 🗳️ **Сроки президента закончились!** Начинается переизбрание. Выберите нового президента через панель управления.'
          }).catch(() => null);
        }
      }
    } catch (e) {
      console.error('startPresidentTimer error:', e.message);
    }
  }, 60 * 1000); // Check every minute
  
  console.log('[PresidentTimer] Started');
}

module.exports = { startPresidentTimer };
