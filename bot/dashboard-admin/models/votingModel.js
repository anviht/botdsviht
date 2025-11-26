// Voting model — управление голосованиями
const db = require('../../libs/db');

const VOTING_DURATION_MS = 10 * 60 * 1000; // 10 minutes

async function startPresidentVoting(guild, initiatorId) {
  try {
    const votingData = {
      type: 'president',
      startedAt: Date.now(),
      endsAt: Date.now() + VOTING_DURATION_MS,
      initiatorId,
      votes: {}, // { userId: true/false for each candidate }
      candidates: [],
      active: true
    };
    if (db && db.set) await db.set('voting', votingData);
    console.log('[Voting] President voting started');
    return votingData;
  } catch (e) {
    console.error('startPresidentVoting error:', e.message);
    return null;
  }
}

function getActiveVoting() {
  const voting = db.get('voting');
  if (!voting || !voting.active) return null;
  if (Date.now() >= voting.endsAt) return null; // Expired
  return voting;
}

async function endVoting() {
  try {
    const voting = db.get('voting');
    if (!voting) return null;
    voting.active = false;
    voting.endedAt = Date.now();
    if (db && db.set) await db.set('voting', voting);
    console.log('[Voting] Voting ended');
    return voting;
  } catch (e) {
    console.error('endVoting error:', e.message);
    return null;
  }
}

function isVotingExpired() {
  const voting = db.get('voting');
  if (!voting || !voting.active) return true;
  return Date.now() >= voting.endsAt;
}

function getVotingRemainingSeconds() {
  const voting = db.get('voting');
  if (!voting || !voting.active) return 0;
  const remaining = voting.endsAt - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

module.exports = {
  startPresidentVoting,
  getActiveVoting,
  endVoting,
  isVotingExpired,
  getVotingRemainingSeconds,
  VOTING_DURATION_MS
};
