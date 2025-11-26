// President model — управление данными президента
const db = require('../../libs/db');

const PRESIDENT_ROLE_ID = '1443200454795329616';
const VALID_VOTER_ROLES = ['1436485697392607303', '1436486253066326067', '1436486486156382299', '1441745037531549777'];
const PRESIDENT_TERM_DAYS = 15;

async function getCurrentPresident(guild) {
  try {
    const presData = db.get('president');
    if (!presData) return null;
    const member = await guild.members.fetch(presData.userId).catch(() => null);
    return { ...presData, member };
  } catch (e) {
    console.warn('getCurrentPresident error:', e.message);
    return null;
  }
}

async function setPresident(userId, guild) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    const presRole = guild.roles.cache.get(PRESIDENT_ROLE_ID);
    if (presRole && member.roles) {
      await member.roles.add(presRole).catch(() => null);
    }
    const presData = {
      userId,
      userTag: member.user.tag,
      electedAt: Date.now(),
      expiresAt: Date.now() + PRESIDENT_TERM_DAYS * 24 * 60 * 60 * 1000
    };
    if (db && db.set) await db.set('president', presData);
    console.log(`[President] ${member.user.tag} elected president`);
    return presData;
  } catch (e) {
    console.error('setPresident error:', e.message);
    return null;
  }
}

async function removePresidentRole(guild) {
  try {
    const presData = db.get('president');
    if (!presData) return;
    const presRole = guild.roles.cache.get(PRESIDENT_ROLE_ID);
    if (!presRole) return;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) return;
    for (const [, member] of members) {
      if (member.roles.cache.has(PRESIDENT_ROLE_ID)) {
        await member.roles.remove(presRole).catch(() => null);
      }
    }
    console.log('[President] Role removed from all members');
  } catch (e) {
    console.error('removePresidentRole error:', e.message);
  }
}

function isPresidentTermExpired() {
  const presData = db.get('president');
  if (!presData) return false;
  return Date.now() >= presData.expiresAt;
}

function getPresidentRemainingDays() {
  const presData = db.get('president');
  if (!presData) return 0;
  const remaining = presData.expiresAt - Date.now();
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

module.exports = {
  getCurrentPresident,
  setPresident,
  removePresidentRole,
  isPresidentTermExpired,
  getPresidentRemainingDays,
  PRESIDENT_ROLE_ID,
  VALID_VOTER_ROLES,
  PRESIDENT_TERM_DAYS
};
