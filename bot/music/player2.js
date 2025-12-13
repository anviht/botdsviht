const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus, getVoiceConnection, entersState, VoiceConnectionStatus, StreamType } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
let playdl = null;
try { playdl = require('play-dl'); } catch (e) { playdl = null; }
const { exec, spawn } = require('child_process');
const db = require('../libs/db');
const { Readable, PassThrough } = require('stream');
const musicLogger = require('./musicLogger');
const musicEmbeds = require('../music-interface/musicEmbeds');
const audioSourceDetector = require('./audioSourceDetector');

// Allow overriding binaries

// Allow overriding binaries via environment variables (useful for pm2)
const YTDLP_BIN = process.env.YTDLP_PATH || process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || 'ffmpeg';

// Log channel for music occupancy and notifications (read from config)
const config = require('../config');
const LOG_CHANNEL_ID = config.musicLogChannelId || '1445848232965181500';

// single in-memory state map
const players = new Map();

function ensureState(guildId) {
  if (!players.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    
    // Add error and state change logging
    player.on('error', (error) => {
      console.error(`[PLAYER ${guildId}] Error:`, error && error.message ? error.message : error);
      try { const s = players.get(guildId); if (s) _killStateProcs(s); } catch (e) { /* ignore */ }
    });
    
    player.on('stateChange', (oldState, newState) => {
      console.log(`[PLAYER ${guildId}] State: ${oldState.status} -> ${newState.status}`);
    });
    
    players.set(guildId, {
      connection: null,
      player: player,
      queue: [],
      volume: 1.0,
      playing: false,
      current: null
      ,
      // track spawned child processes and active streams for cleanup
      _procs: []
    });
  }
  return players.get(guildId);
}

function _killStateProcs(state) {
  try {
    if (!state || !state._procs || !state._procs.length) return;
    for (const item of state._procs.splice(0)) {
      try {
        if (!item) continue;
        // child_process instances
        if (item.kill && typeof item.kill === 'function') {
          try { item.kill('SIGKILL'); } catch (e) { try { item.kill(); } catch (e2) {} }
        }
        // streams with destroy
        if (item.destroy && typeof item.destroy === 'function') {
          try { item.destroy(); } catch (e) { /* ignore */ }
        }
        // if wrapper object {proc, stream}
        if (item.proc && item.proc.kill) {
          try { item.proc.kill('SIGKILL'); } catch (e) { try { item.proc.kill(); } catch (e2) {} }
        }
        if (item.stream && item.stream.destroy) {
          try { item.stream.destroy(); } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.warn('Error killing state proc', e && e.message);
      }
    }
    state._procs = [];
  } catch (e) { console.warn('killStateProcs failed', e && e.message); }
}

async function loadSavedQueues() {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const queues = music.queues || {};
    for (const [guildId, q] of Object.entries(queues)) {
      const s = ensureState(guildId);
      s.queue = Array.isArray(q) ? q : [];
      s.volume = (music.volumes && music.volumes[guildId]) || s.volume;
    }
  } catch (e) { console.warn('loadSavedQueues failed', e && e.message); }
}

loadSavedQueues().catch(() => {});

async function saveQueueForGuild(guildId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.queues = music.queues || {};
    music.queues[guildId] = players.has(guildId) ? players.get(guildId).queue : [];
    music.volumes = music.volumes || {};
    music.volumes[guildId] = players.has(guildId) ? players.get(guildId).volume : 1.0;
    await db.set('music', music);
  } catch (e) { console.warn('saveQueueForGuild failed', e && e.message); }
}

// Helper: update control message with error or status and back button
async function updateControlMessageWithError(guildId, client, content) {
  // Silent: do not post error embeds to the control channel anymore.
  // Previously this function updated the public control panel with error messages
  // (e.g. "❌ Ошибка при воспроизведении.") which produced unwanted UI spam.
  // Now we log the content server-side and return false so callers can fallback
  // to private notifications if needed.
  try {
    console.warn('[updateControlMessageWithError] Suppressed public message:', content);
  } catch (e) {
    /* ignore */
  }
  return false;
}

// Notify session owner privately (DM). Returns true if DM sent, false otherwise.
async function notifyOwner(guildId, state, ownerId, content) {
  try {
    const owner = ownerId || (state && state.current && state.current.owner) || null;
    const client = (state && state._client) ? state._client : (players.get(guildId) && players.get(guildId)._client) ? players.get(guildId)._client : null;
    if (!owner || !client || !client.users) {
      console.warn('[PLAYER] suppressed public message (no owner/client):', content);
      return false;
    }
    const u = await client.users.fetch(String(owner)).catch(() => null);
    if (!u) {
      console.warn('[PLAYER] owner not found to DM:', owner, 'message:', content);
      return false;
    }
    await u.send(content).catch((e) => { console.warn('[PLAYER] failed to DM owner', e && e.message); });
    return true;
  } catch (e) {
    console.warn('[PLAYER] notifyOwner failed', e && e.message);
    return false;
  }
}

// Update control message to show now playing with progress
async function updateControlMessageNowPlaying(guildId, client, title, currentMs, durationMs, ownerId) {
  try {
    const panelKey = `musicControl_${guildId}`;
    const panelRec = db.get(panelKey);
    if (!panelRec || !panelRec.channelId || !panelRec.messageId) return false;
    const ch = await client.channels.fetch(panelRec.channelId).catch(() => null);
    if (!ch || !ch.messages) return false;
    const msg = await ch.messages.fetch(panelRec.messageId).catch(() => null);
    if (!msg || !msg.edit) return false;

    const embed = musicEmbeds.createNowPlayingWithProgressEmbed(title, currentMs, durationMs);
    // Build control buttons: if ownerId matches panelRec.owner, show owner controls, else show claim button
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const components = [];
    if (panelRec && panelRec.owner && ownerId && String(panelRec.owner) === String(ownerId)) {
      // Primary owner controls
      const ownerRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel('⏸ Пауза').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Пропустить').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_add_fav').setLabel('❤️ В избранное').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music_playlist_add_current').setLabel('➕ В плейлист').setStyle(ButtonStyle.Primary)
      );
      components.push(ownerRow);

      // Volume controls row
      try {
        const volRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_volume_down').setLabel('🔉 Тише').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('music_volume_up').setLabel('🔊 Громче').setStyle(ButtonStyle.Primary)
        );
        components.push(volRow);
      } catch (e) { /* ignore */ }

      // Add playlist quick-actions: play / add current / delete (up to 5 per row)
      try {
        const pls = getPlaylists(guildId, ownerId) || {};
        const ids = Object.keys(pls || {});
        if (ids.length > 0) {
          // Play buttons row (max 5)
          const playBtns = new ActionRowBuilder();
          let playCount = 0;
          for (const pid of ids) {
            if (playCount >= 5) break;
            const label = (pls[pid] && pls[pid].name) ? (pls[pid].name.substring(0, 80)) : `Playlist ${pid}`;
            playBtns.addComponents(new ButtonBuilder().setCustomId(`music_play_pl_${guildId}_${pid}`).setLabel(`▶ ${label}`).setStyle(ButtonStyle.Success));
            playCount++;
          }
          if (playCount > 0) components.push(playBtns);

          // Add-current buttons row (max 5)
          const addBtns = new ActionRowBuilder();
          let addCount = 0;
          for (const pid of ids) {
            if (addCount >= 5) break;
            const label = (pls[pid] && pls[pid].name) ? (pls[pid].name.substring(0, 60)) : `Playlist ${pid}`;
            addBtns.addComponents(new ButtonBuilder().setCustomId(`music_addcurrent_pl_${guildId}_${pid}`).setLabel(`➕ ${label}`).setStyle(ButtonStyle.Primary));
            addCount++;
          }
          if (addCount > 0) components.push(addBtns);

          // Delete buttons row (danger) (max 5)
          const delBtns = new ActionRowBuilder();
          let delCount = 0;
          for (const pid of ids) {
            if (delCount >= 5) break;
            const label = (pls[pid] && pls[pid].name) ? (pls[pid].name.substring(0, 50)) : `Playlist ${pid}`;
            delBtns.addComponents(new ButtonBuilder().setCustomId(`music_delete_pl_${guildId}_${pid}`).setLabel(`🗑 ${label}`).setStyle(ButtonStyle.Danger));
            delCount++;
          }
          if (delCount > 0) components.push(delBtns);
        }
      } catch (e) {
        // ignore playlist rendering errors
      }
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_register').setLabel('🎵 Занять плеер').setStyle(ButtonStyle.Primary)
      );
      components.push(row);
    }

    await msg.edit({ embeds: [embed], components }).catch(() => {});
    return true;
  } catch (e) { console.error('updateControlMessageNowPlaying failed', e && e.message); return false; }
}

async function findYouTubeUrl(query) {
  if (!query) return null;
  
  // Extract title from URL if it's a YouTube link, otherwise use query as-is
  let searchQuery = query;
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)) {
    // Extract video ID
    let vidId = null;
    const youtubeMatch = query.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (youtubeMatch) vidId = youtubeMatch[1];
    
    // Try to get video title via yt-search by ID (or just search by partial info)
    if (vidId) {
      searchQuery = `youtube ${vidId}`;
    }
  }
  
  try {
    // Try direct search and collect candidates
    let r = await yts(searchQuery);
    let vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && (v.seconds || 0) > 20) : [];

    // Blacklist and game-related terms we definitely want to exclude
    const blacklist = ['full album', 'full song', 'full mix', 'album', 'movie', 'episode', 'podcast', 'interview', 'documentary', 'soundtrack', 'mashup', 'compilation'];
    const gamingBlacklist = ['gameplay', 'minecraft', "let's play", 'walkthrough', 'gameplay', 'скриншот', 'стрим', 'влог', 'геймплей', 'обзор'];
    const liveBlacklist = ['live', 'live concert', 'live performance', 'живой концерт', 'live session', 'концерт', 'performance', 'with lyrics', 'lyric video'];
    const queryLower = (query || '').toLowerCase();
    const prefersLong = blacklist.some(w => queryLower.includes(w));

    // Helper to compute a relevance score for each video
    function scoreVideo(v) {
      const title = (v.title || '').toLowerCase();
      const author = ((v.author && v.author.name) || (v.owner && v.owner.name) || '').toLowerCase();
      const seconds = v.seconds || 0;
      let score = 0;

      // Penalize obvious non-music/gaming videos
      for (const g of gamingBlacklist) if (title.includes(g) || author.includes(g)) return -9999;
      
      // Penalize live performances and streams (unless specifically requested)
      if (!queryLower.includes('live') && !queryLower.includes('concert')) {
        for (const l of liveBlacklist) {
          if (title.includes(l)) score -= 50;
        }
      }

      // Strongly prefer official audio/music sources
      const musicIndicators = ['official audio', 'official music', 'audio', 'official video', 'music video', 'official', 'vevo', 'topic'];
      let hasMusic = false;
      for (const mi of musicIndicators) {
        if (author.includes(mi) || title.includes(mi)) {
          hasMusic = true;
          if (mi === 'official audio' || mi === 'official music') score += 100;
          else if (mi === 'audio' || mi === 'vevo' || mi === 'topic') score += 50;
          else score += 20;
        }
      }
      
      // If query looks like song name (has "artist - song" or similar), require it's not a cover/remix/parody
      const isSongQuery = /\s*-\s*/.test(queryLower) || queryLower.split(' ').length <= 5;
      if (isSongQuery) {
        const avoidKeywords = ['cover', 'remix', 'edit', 'parody', 'tribute', 'reaction', 'tutorial', 'lesson', 'how to'];
        for (const ak of avoidKeywords) {
          if (title.includes(ak) && !author.includes(ak)) score -= 40;
        }
      }

      // Word match scoring - require tokens from query
      const tokens = queryLower.split(/\s+/).filter(Boolean);
      let matches = 0;
      for (const t of tokens) {
        if (t.length < 2) continue;
        if (title.includes(t) || author.includes(t)) matches++;
      }
      score += matches * 20;

      // Strongly favor typical song durations (2-8 minutes for most songs, 1-15 min for extended)
      if (seconds >= 120 && seconds <= 480) score += 50; // 2-8 min - ideal for normal songs
      if (seconds >= 30 && seconds <= 120) score += 30;  // 30 sec - 2 min (short versions, intros)
      if (seconds >= 480 && seconds <= 900) score += 20; // 8-15 min (extended/remixes)
      if (seconds < 30) score -= 100;                     // Too short
      if (seconds > 1200) score -= 80;                    // Way too long (likely not a song)

      return score;
    }

    // Filter out blacklist terms and gameplay; then score and sort
    vids = vids.filter(v => {
      const t = (v.title || '').toLowerCase();
      const a = ((v.author && v.author.name) || (v.owner && v.owner.name) || '').toLowerCase();
      const seconds = v.seconds || 0;
      
      // Reject extremely short or long videos
      if (seconds < 30) return false;
      if (!prefersLong && seconds > 1200) return false; // reject > 20 min unless asking for album/compilation
      
      // Reject gaming content
      if (t.includes('gameplay') || t.includes('minecraft') || a.includes('геймплей')) return false;
      
      // Reject blacklist terms
      for (const b of blacklist) if (!prefersLong && t.includes(b)) return false;
      
      return true;
    });

    // If too many, compute scores and sort by score desc then duration closeness
    if (vids.length) {
      const scored = vids.map(v => ({ v, score: scoreVideo(v) }));
      scored.sort((a, b) => b.score - a.score || ((a.v.seconds || 0) - (b.v.seconds || 0)));
      vids = scored.filter(s => s.score > -1000).map(s => s.v);
    }

    // If nothing good found, try targeted searches to prefer official audio/lyrics
    if (!vids.length) {
      // Prioritize: official audio > official video > lyrics > audio > default
      const variants = [`${searchQuery} official audio`, `${searchQuery} official music`, `${searchQuery} official`, `${searchQuery} lyrics`, `${searchQuery} audio`];
      for (const vq of variants) {
        try {
          const rr = await yts(vq);
          const found = rr && rr.videos ? rr.videos.filter(x => !x.live && (x.seconds || 0) > 20) : [];
          if (found && found.length) {
            // score found set and pick best
            const scored = found.map(x => ({ v: x, score: scoreVideo(x) }));
            scored.sort((a, b) => b.score - a.score || ((a.v.seconds || 0) - (b.v.seconds || 0)));
            const chosen = scored.find(s => s.score > -1000);
            if (chosen) { vids = [chosen.v]; break; }
            vids = found.slice(0, 5); // Take top 5 if good ones found
          }
        } catch (e) { /* ignore */ }
      }
    }

    // Try broader search fallback
    if (!vids.length) {
      r = await yts(query.split('?')[0].split('/').pop() || query);
      vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && (v.seconds || 0) > 20) : [];
    }

    // If still nothing and play-dl is available, try play-dl search as a fallback
    if (!vids.length && playdl) {
      try {
        const pls = await playdl.search(searchQuery, { limit: 6 }).catch(() => null);
        if (pls && Array.isArray(pls) && pls.length) {
          vids = pls.map(p => ({ url: p.url || (p.id ? `https://www.youtube.com/watch?v=${p.id}` : null), title: p.title || p.name }));
        }
      } catch (e) { /* ignore */ }
    }

    const candidates = vids.map(v => ({ url: v.url, title: v.title }));
    return candidates.length ? { candidates } : null;
  } catch (e) {
    console.warn('findYouTubeUrl failed', e && e.message);
    return null;
  }
}

function isYouTubeUrl(url) {
  try { return /youtube\.com|youtu\.be/.test(url); } catch (e) { return false; }
}

async function streamFromUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      // request ICY metadata to some streams (optional)
      'Icy-MetaData': '1'
    };
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!res || !res.body) {
      console.warn('streamFromUrl: no response body for', url);
      return null;
    }
    if (!res.ok && res.status >= 400) {
      console.warn('streamFromUrl: non-ok status', res.status, 'for', url);
      return null;
    }

    // If body is already a Node.js stream (has .pipe), return it directly
    const body = res.body;
    if (body && typeof body.pipe === 'function') {
      return body;
    }

    // If it's a WHATWG ReadableStream (web stream), convert to Node Readable
    try {
      if (typeof Readable.fromWeb === 'function' && body && typeof body.getReader === 'function') {
        return Readable.fromWeb(body);
      }
    } catch (e) {
      // continue to fallback
    }

    // Fallback: pipe into a PassThrough by reading via async iterator
    try {
      const pass = new PassThrough();
      (async () => {
        try {
          for await (const chunk of body) {
            if (!pass.write(chunk)) await new Promise(r => pass.once('drain', r));
          }
        } catch (e) {
          // ignore
        } finally {
          pass.end();
        }
      })();
      return pass;
    } catch (e) {
      console.warn('streamFromUrl conversion failed', e && e.message);
      return null;
    }
  } catch (e) { console.warn('streamFromUrl failed', e && e.message); return null; }
}

async function getStreamFromYtDlp(url) {
  return new Promise((resolve) => {
    const cmd = `${YTDLP_BIN} -f "bestaudio" -g "${url.replace(/"/g, '\\"')}" 2>&1`;
    // Increase exec timeout to allow yt-dlp more time on slower systems
    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err || !stdout || stdout.includes('ERROR')) {
          console.warn('yt-dlp failed:', err && err.message, 'stdout:', (stdout||'').slice(0,200), 'stderr:', (stderr||'').slice(0,400));
          resolve(null);
      } else {
        const lines = stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('['));
        const directUrl = lines[lines.length - 1];
        if (directUrl && directUrl.startsWith('http')) {
          console.log('yt-dlp extracted URL:', directUrl.substring(0, 80));
          resolve(directUrl);
        } else {
          console.warn('yt-dlp output invalid:', lines);
          resolve(null);
        }
      }
    });
  });
}

// Spawn yt-dlp and pipe its stdout into ffmpeg to produce raw PCM stream
async function getStreamFromYtDlpPipe(url, state) {
  return new Promise((resolve) => {
    try {
      const yt = spawn(YTDLP_BIN, ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'pipe'] });
      yt.on('error', (e) => {
        console.warn('yt-dlp spawn error:', e && e.message);
        try { yt.kill(); } catch (er) {}
        resolve(null);
      });

      // If yt-dlp produced no stdout quickly, consider it failed
      const ffmpegBin = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || FFMPEG_BIN;
      const ff = spawn(ffmpegBin, ['-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
      ff.on('error', (e) => {
        console.warn('ffmpeg spawn error for yt-dlp pipe:', e && e.message);
        try { yt.kill(); } catch (er) {}
        try { ff.kill(); } catch (er) {}
        resolve(null);
      });

      // pipe yt stdout into ffmpeg stdin
      yt.stdout.pipe(ff.stdin);

      // watch stderr for hints
      ff.stderr.on('data', (d) => { console.log('yt-dlp->ffmpeg stderr:', String(d).slice(0,200)); });

      // register processes on state for later cleanup (if provided)
      try {
        if (state && state._procs) {
          state._procs.push(yt);
          state._procs.push(ff);
        }
      } catch (e) { /* ignore */ }

      // give it a short grace period to start producing data
      let started = false;
      const onReadable = () => {
        if (!started) {
          started = true;
          console.log('getStreamFromYtDlpPipe: started streaming for', url.substring(0,80));
          // return stream and leave processes registered on state
          resolve(ff.stdout);
        }
      };

      ff.stdout.once('readable', onReadable);

      // if either process exits without producing data, fail
      const fail = () => {
        if (!started) {
          try { yt.kill(); } catch (e) {}
          try { ff.kill(); } catch (e) {}
          resolve(null);
        }
      };

      yt.on('close', fail);
      ff.on('close', fail);

      // fallback timeout — give more time for yt-dlp+ffmpeg to negotiate streams
      setTimeout(() => {
        if (!started) {
          console.warn('getStreamFromYtDlpPipe: timeout waiting for stream', url.substring(0,80));
          fail();
        }
      }, 15000);
    } catch (e) {
      console.warn('getStreamFromYtDlpPipe error', e && e.message);
      resolve(null);
    }
  });
}

async function playNow(guild, voiceChannel, queryOrUrl, textChannel, userId, playOptions = {}) {
  try {
    const state = ensureState(guild.id);
    // keep a reference to client for control message updates
    try { if (guild && guild.client) state._client = guild.client; } catch (e) {}
    // Clear the stop flag when starting new playback
    state._userRequestedStop = false;

    // Owner check: if someone else owns the player, deny interruption
    try {
      if (state && state.current && state.current.owner && userId && state.current.owner !== String(userId)) {
        const owner = state.current.owner;
        const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
        const msgText = `❌ Плеер занят пользователем <@${owner}>. Дождитесь завершения или попросите его остановить.`;
        let updated = false;
        if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
        if (!updated) await notifyOwner(guild.id, state, userId, msgText);
        return false;
      }
    } catch (e) { /* ignore */ }

    // allowed to proceed: cleanup previous procs/streams
    try { _killStateProcs(state); } catch (e) {}

    // Try new multi-source audio detector first
    console.log('[playNow] Using new audio source detector for:', queryOrUrl.substring(0, 80));
    const audioResult = await audioSourceDetector.getAudioStream(queryOrUrl);
    
    if (!audioResult.success) {
      console.warn('[playNow] Audio source detector failed:', audioResult.error);
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = `❌ Не удалось найти трек по запросу: ${audioResult.error || 'неизвестная ошибка'}`;
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }
    
    // Use the URL from audio detector as fallback to old findYouTubeUrl
    // This maintains compatibility while adding new sources
    let url = audioResult.url || (await findYouTubeUrl(queryOrUrl));
    if (!url && audioResult.url) {
      url = audioResult.url;
    }
    
    if (!url) {
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = '❌ Не удалось найти трек по запросу.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }

    // If another user currently owns the player, deny interruption
    try {
      if (state && state.current && state.current.owner && userId && state.current.owner !== String(userId)) {
        const owner = state.current.owner;
        const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
        const msgText = `❌ Плеер занят пользователем <@${owner}>. Дождитесь завершения или попросите его остановить.`;
        let updated = false;
        if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
        if (!updated) await notifyOwner(guild.id, state, userId, msgText);
        return false;
      }
    } catch (e) { /* ignore */ }

    let connection = getVoiceConnection(guild.id);
    if (!connection) {
      console.log('playNow: Creating new voice connection for guild', guild.id);
      connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
      state.connection = connection;
      try {
        // Wait for the underlying voice connection to become ready
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        console.log('playNow: Voice connection is Ready, guild', guild.id);
      } catch (e) {
        console.warn('playNow: connection not ready', e && e.message);
        {
          const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
          const msgText = '❌ Ошибка подключения к голосовому каналу.';
          let updated = false;
          if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
          if (!updated) await notifyOwner(guild.id, state, userId, msgText);
        }
        return false;
      }
    } else {
      console.log('playNow: Using existing voice connection for guild', guild.id);
    }
    
      // Subscribe immediately after ensuring connection is ready
      try {
        connection.subscribe(state.player);
        console.log('playNow: Connection subscribed to player, guild', guild.id);
      } catch (e) {
        console.warn('playNow: subscribe failed', e && e.message);
      }

    let resource = null;
    let resolvedUrl = null;

    // Handle findYouTubeUrl return types: it may return a string (direct URL) or an object { candidates: [...] }
    const candidates = [];
    if (typeof url === 'string') {
      // plain string — could be YouTube or direct link
      if (isYouTubeUrl(url)) candidates.push(url);
      else {
        // direct non-YouTube URL: try to stream it directly
        const stream = await streamFromUrl(url);
        if (!stream) { const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null); const msgText = '❌ Не удалось открыть поток.'; let updated = false; if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(()=>false); if (!updated) await notifyOwner(guild.id, state, userId, msgText); return false; }
        try {
          resource = createAudioResource(stream, { inputType: StreamType.WebmOpus, inlineVolume: true });
        } catch (err) {
          resource = createAudioResource(stream, { inlineVolume: true });
        }
        resolvedUrl = url;
      }
    } else if (url && Array.isArray(url.candidates)) {
      for (const c of url.candidates) {
        candidates.push({ url: c.url || c, title: c.title || null });
      }
    }

    if (candidates.length > 0) {
      const attempted = [];
      const attemptDetails = [];
      let lastErr = null;
      // iterate candidates sequentially
      for (const candidate of candidates) {
        const candidateUrl = (typeof candidate === 'string') ? candidate : candidate.url;
        const candidateTitle = (typeof candidate === 'object' && candidate.title) ? candidate.title : null;
        attempted.push(candidateUrl);
        const detail = { candidate: candidateUrl, title: candidateTitle, attempts: [] };
          // If caller requested to skip certain resolved URLs (retry flow), honor that
          try {
            if (playOptions && Array.isArray(playOptions.skipResolved) && playOptions.skipResolved.includes(candidateUrl)) {
              detail.attempts.push({ method: 'skip', ok: false, reason: 'skipped by retry options' });
              attemptDetails.push(detail);
              console.log('Skipping candidate because it was previously tried:', candidateUrl.substring(0, 80));
              continue;
            }
          } catch (e) { /* ignore */ }

        // 1) Try play-dl FIRST (most reliable against YouTube blocking)
        if (!resource && playdl) {
          try {
            console.log('Attempting play-dl for', (candidateTitle || candidateUrl).substring(0, 80));
            let pl = null;
            try {
              // play-dl sometimes prefers shorthand URL format
              let urlToTry = candidateUrl;
              
              // Extract video ID from long URLs and try shorthand format too
              const vidMatch = candidateUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
              if (vidMatch && vidMatch[1]) {
                // Try shorthand first
                const shortUrl = `https://youtu.be/${vidMatch[1]}`;
                try {
                  pl = await playdl.stream(shortUrl).catch(() => null);
                } catch (e) {
                  pl = null;
                }
                
                // Fall back to full URL if short didn't work
                if (!pl) {
                  try {
                    pl = await playdl.stream(candidateUrl).catch(() => null);
                  } catch (e) {
                    pl = null;
                  }
                }
              } else {
                pl = await playdl.stream(candidateUrl).catch(() => null);
              }
            } catch (e) {
              console.warn('play-dl.stream() threw:', String(e && e.message || e).slice(0, 150));
              pl = null;
            }
            
            if (pl && pl.stream) {
              resource = createAudioResource(pl.stream, { inlineVolume: true });
              resolvedUrl = candidateUrl;
              resolvedTitle = candidateTitle || (pl && (pl.video_info && (pl.video_info.title || pl.video_info.name)));
              detail.attempts.push({ method: 'play-dl', ok: true });
              attemptDetails.push(detail);
              console.log('✅ play-dl SUCCESS for', candidateUrl.substring(0, 80));
              break;
            } else {
              console.warn('play-dl returned no stream for', candidateUrl.substring(0, 80), 'pl=', pl ? 'object' : 'null');
              detail.attempts.push({ method: 'play-dl', ok: false, error: 'no stream returned' });
            }
          } catch (e) { 
            const errMsg = String(e && e.message || e).slice(0, 100);
            detail.attempts.push({ method: 'play-dl', ok: false, error: errMsg }); 
            console.warn('play-dl catch block:', candidateUrl.substring(0, 80), errMsg); 
            lastErr = e; 
          }
        } else if (!resource) {
          if (!playdl) {
            console.warn('play-dl is not available');
            detail.attempts.push({ method: 'play-dl', ok: false, error: 'play-dl not installed' });
          }
        }

        // Before starting candidate attempts, ensure previous procs/streams are cleaned
        try { _killStateProcs(state); } catch (e) { /* ignore */ }

        // 2) Fallback: ytdl-core with safe wrapper
        // Before trying ytdl-core, try an aggressive yt-dlp -> ffmpeg pipe fallback
        if (!resource) {
          try {
            console.log('Attempting yt-dlp -> ffmpeg pipe early for', candidateUrl.substring(0,80));
                const pipeStreamEarly = await getStreamFromYtDlpPipe(candidateUrl, state).catch(() => null);
            if (pipeStreamEarly) {
              try {
                resource = createAudioResource(pipeStreamEarly, { inputType: StreamType.Raw, inlineVolume: true });
                resolvedUrl = candidateUrl;
                detail.attempts.push({ method: 'yt-dlp-pipe-early', ok: true });
                attemptDetails.push(detail);
                console.log('✅ yt-dlp pipe (early) SUCCESS for', candidateUrl.substring(0,80));
              } catch (e) {
                console.warn('yt-dlp pipe (early) createAudioResource failed:', e && e.message);
                try { if (pipeStreamEarly && typeof pipeStreamEarly.destroy === 'function') pipeStreamEarly.destroy(); } catch (ee) {}
              }
            } else {
              detail.attempts.push({ method: 'yt-dlp-pipe-early', ok: false, error: 'no pipe stream' });
            }
          } catch (e) {
            detail.attempts.push({ method: 'yt-dlp-pipe-early', ok: false, error: String(e && e.message || e).slice(0,100) });
          }
        }

        // Wrap in Promise to catch async errors from stream reading
        if (!resource) {
          try {
            console.log('Attempting ytdl-core for', (candidateTitle || candidateUrl).substring(0, 80));
            
            // Create stream safely with error handling
            let stream = null;
            let streamError = null;
            
            // Try different quality options
            const qualityOptions = [
              { filter: 'audioonly', quality: 'highestaudio' },
              { filter: 'audioonly', quality: 'lowestaudio' },
              { filter: 'audio' }
            ];
            
            for (const opts of qualityOptions) {
                try {
                // First attempt to fetch video info to ensure signature extraction works
                try {
                  await ytdl.getInfo(candidateUrl);
                } catch (infoErr) {
                  console.warn('ytdl-core getInfo failed, skipping candidate:', String(infoErr && infoErr.message || infoErr).slice(0,200));
                  stream = null;
                  continue; // try next quality option or candidate
                }
                // Use better options for ytdl-core to avoid YouTube blocking
                const ytdlOpts = {
                  ...opts,
                  highWaterMark: 1 << 25,
                  requestOptions: {
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                  }
                };
                
                stream = ytdl(candidateUrl, ytdlOpts);
                
                if (stream) {
                  // Wrap raw ytdl stream into a PassThrough so we can handle async stream errors
                  const pass = new PassThrough();

                  // Attach error handler BEFORE piping to pass-through
                  stream.on('error', (err) => {
                    streamError = err;
                    console.warn('ytdl stream async error:', String(err && err.message || err).slice(0, 200));
                    try { pass.destroy(err); } catch (e) { /* ignore */ }
                    // Stop the player gracefully if something goes wrong after play started
                    try { if (state && state.player) state.player.stop(); } catch (e) { /* ignore */ }
                  });

                  // Also handle unexpected end/close on the underlying stream
                  stream.on('close', () => {
                    console.log('ytdl stream closed for', candidateUrl.substring(0, 80));
                  });

                  // Pipe into pass-through and create resource from pass
                  stream.pipe(pass);

                  try {
                    resource = createAudioResource(pass, { inlineVolume: true });
                    resolvedUrl = candidateUrl;
                    resolvedTitle = candidateTitle;
                    detail.attempts.push({ method: 'ytdl-core', ok: true });
                    attemptDetails.push(detail);
                    console.log('✅ ytdl-core SUCCESS for', candidateUrl.substring(0, 80));
                    break;
                  } catch (e) {
                    console.warn('ytdl-core createAudioResource failed:', String(e && e.message || e).slice(0, 200));
                    try { pass.destroy(); } catch (ee) { /* ignore */ }
                    stream = null;
                    // Try next quality option
                    continue;
                  }
                }
              } catch (e) {
                console.warn(`ytdl-core quality=${opts.quality} failed:`, String(e && e.message || e).slice(0, 100));
                stream = null;
                continue;
              }
            }
            
            if (!resource && !stream) {
              detail.attempts.push({ method: 'ytdl-core', ok: false, error: 'all quality options failed' });
            }
          } catch (e) {
            const errMsg = String(e && e.message || e).slice(0, 100);
            detail.attempts.push({ method: 'ytdl-core', ok: false, error: errMsg });
            console.warn('ytdl-core outer catch:', candidateUrl.substring(0, 80), errMsg);
          }
        }

        if (!resource) {
          // As a last resort try yt-dlp CLI to extract a direct URL and stream that
          try {
            console.log('Attempting yt-dlp CLI for', (candidateTitle || candidateUrl).substring(0, 80));
            const direct = await getStreamFromYtDlp(candidateUrl).catch(() => null);
            if (direct) {
              let s = await streamFromUrl(direct).catch(() => null);
              if (s) {
                try {
                  resource = createAudioResource(s, { inlineVolume: true });
                  resolvedUrl = direct;
                  resolvedTitle = candidateTitle;
                  detail.attempts.push({ method: 'yt-dlp-cli', ok: true });
                  attemptDetails.push(detail);
                  console.log('✅ yt-dlp CLI SUCCESS for', candidateUrl.substring(0, 80));
                  break;
                } catch (e) {
                  console.warn('yt-dlp createAudioResource failed:', e && e.message);
                  try { if (s && typeof s.destroy === 'function') s.destroy(); } catch (ee) {}
                }
              } else {
                // streamFromUrl failed for direct URL — try piping yt-dlp -> ffmpeg directly
                try {
                  const pipeStream = await getStreamFromYtDlpPipe(candidateUrl, state).catch(() => null);
                  if (pipeStream) {
                    try {
                      resource = createAudioResource(pipeStream, { inputType: StreamType.Raw, inlineVolume: true });
                      resolvedUrl = candidateUrl;
                      resolvedTitle = candidateTitle;
                      detail.attempts.push({ method: 'yt-dlp-pipe', ok: true });
                      attemptDetails.push(detail);
                      console.log('✅ yt-dlp pipe SUCCESS for', candidateUrl.substring(0, 80));
                      break;
                    } catch (e) {
                      console.warn('yt-dlp pipe createAudioResource failed:', e && e.message);
                      try { if (pipeStream && typeof pipeStream.destroy === 'function') pipeStream.destroy(); } catch (ee) {}
                    }
                  } else {
                    detail.attempts.push({ method: 'yt-dlp-pipe', ok: false, error: 'no pipe stream' });
                  }
                } catch (e) {
                  detail.attempts.push({ method: 'yt-dlp-pipe', ok: false, error: String(e && e.message || e).slice(0,100) });
                }
                detail.attempts.push({ method: 'yt-dlp-cli', ok: false, error: 'streamFromUrl failed' });
              }
            } else {
              // direct URL extraction failed, try yt-dlp -> ffmpeg pipe directly
              try {
                const pipeStream = await getStreamFromYtDlpPipe(candidateUrl, state).catch(() => null);
                if (pipeStream) {
                  try {
                    resource = createAudioResource(pipeStream, { inputType: StreamType.Raw, inlineVolume: true });
                    resolvedUrl = candidateUrl;
                    detail.attempts.push({ method: 'yt-dlp-pipe', ok: true });
                    attemptDetails.push(detail);
                    console.log('✅ yt-dlp pipe SUCCESS for', candidateUrl.substring(0, 80));
                    break;
                  } catch (e) {
                    console.warn('yt-dlp pipe createAudioResource failed:', e && e.message);
                    try { if (pipeStream && typeof pipeStream.destroy === 'function') pipeStream.destroy(); } catch (ee) {}
                  }
                } else {
                  detail.attempts.push({ method: 'yt-dlp-pipe', ok: false, error: 'no pipe stream' });
                }
              } catch (e) {
                detail.attempts.push({ method: 'yt-dlp-pipe', ok: false, error: String(e && e.message || e).slice(0,100) });
              }
              detail.attempts.push({ method: 'yt-dlp-cli', ok: false, error: 'no url' });
            }
          } catch (e) {
            detail.attempts.push({ method: 'yt-dlp-cli', ok: false, error: String(e && e.message || e).slice(0,100) });
          }

          attemptDetails.push(detail);
        } else {
          break;
        }
      }

      if (!resource) {
        console.error('All music candidates failed:', attempted);
        // Short error message to avoid Discord 2000 char limit
        const msg = `❌ Ошибка: Не удалось получить аудиопоток. Попробуйте другую песню.`;
        if (textChannel && textChannel.send) {
          const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
          let updated = false;
          if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
          if (!updated) await notifyOwner(guild.id, state, userId, msg);
        }
        return false;
      }
    }

    if (resource) {
      try { console.log('Selected resource attemptDetails:', JSON.stringify(attemptDetails).slice(0,2000)); } catch (e) {}
      try { if (resource.volume) resource.volume.setVolume(state.volume || 1.0); } catch (e) {}
    }
    
    state.player.stop();
    try {
      state.player.play(resource);
    } catch (e) {
      console.error('playNow: player.play() failed:', e && e.message);
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = '❌ Ошибка при запуске плеера.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }
    state.playing = true;
    // Use resolvedTitle (preferred) or URL for display; do not post raw URLs into chat when possible
    const displayTitle = resolvedTitle || (resolvedUrl && typeof resolvedUrl === 'string' ? resolvedUrl : (typeof url === 'string' ? url : 'Музыка'));
    state.current = { url: resolvedUrl || (typeof url === 'string' ? url : null), title: displayTitle, owner: userId ? String(userId) : null, type: 'music' };

    // Сохранить в историю и как последний трек
    try {
      await addToHistory(guild.id, userId || 'unknown', state.current);
      await saveLastTrack(guild.id, state.current);
      if (userId) await unlockAchievement(userId, 'played_music');
      
      // Log the music play
      const voiceChannelName = voiceChannel && voiceChannel.name ? voiceChannel.name : 'Unknown Voice';
      await musicLogger.logMusicPlay(guild, userId || 'unknown', displayTitle, voiceChannelName);
    } catch (e) { /* ignore */ }

    // Set up duration if possible
    try {
      if (resolvedUrl) {
        try {
          const info = await ytdl.getInfo(resolvedUrl).catch(() => null);
          const len = info && info.videoDetails && info.videoDetails.lengthSeconds ? parseInt(info.videoDetails.lengthSeconds, 10) : 0;
          state.current.durationMs = len ? (len * 1000) : 0;
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    // Start progress updater in control panel
    try {
      if (state._progressInterval) { clearInterval(state._progressInterval); state._progressInterval = null; }
      state._progressStart = Date.now();
      state._progressElapsed = 0;
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      if (clientForPanel) {
        // initial update
        await updateControlMessageNowPlaying(guild.id, clientForPanel, displayTitle, 0, state.current.durationMs || 0, state.current.owner).catch(() => {});
        state._progressInterval = setInterval(async () => {
          try {
            state._progressElapsed = Date.now() - state._progressStart;
            await updateControlMessageNowPlaying(guild.id, clientForPanel, displayTitle, state._progressElapsed, state.current.durationMs || 0, state.current.owner).catch(() => {});
          } catch (e) { /* ignore */ }
        }, 1000);
      }

    } catch (e) { /* ignore */ }

    // Short-play monitor: if playback stops/pauses within MIN_GOOD_PLAY_MS, consider it a failure and retry
    try {
      const MIN_GOOD_PLAY_MS = parseInt(process.env.MIN_GOOD_PLAY_MS || '5000', 10) || 5000;
      let playedSuccessfully = false;
      let goodTimer = null;

      const onShortPlayStateChange = (oldState, newState) => {
        try {
          if (playedSuccessfully) return;
          const s = newState && newState.status ? newState.status : null;
          if (!s) return;
          if (s === AudioPlayerStatus.Idle || s === AudioPlayerStatus.AutoPaused || s === AudioPlayerStatus.Paused) {
            console.warn('Short playback detected for', (resolvedUrl || '').toString().substring(0,120));
            try { _killStateProcs(state); } catch (e) {}
            try { state.player.stop(); } catch (e) {}

            try {
              const attempts = (playOptions && playOptions.attemptCount) ? playOptions.attemptCount : 0;
              const MAX_RETRIES = 3;
              if (attempts < MAX_RETRIES) {
                state._inRetry = true;
                const skips = Array.isArray(playOptions && playOptions.skipResolved) ? [...playOptions.skipResolved] : [];
                if (resolvedUrl) skips.push(resolvedUrl);
                const nextOptions = { skipResolved: skips, attemptCount: attempts + 1 };
                (async () => {
                  try {
                    console.log('Retrying playback (attempt', nextOptions.attemptCount, ') skipping', skips.join(','));
                    await playNow(guild, voiceChannel, queryOrUrl, textChannel, userId, nextOptions).catch(() => {});
                  } catch (e) {}
                })();
              } else {
                try {
                  (async () => {
                    try {
                      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
                      const msg = '❌ Не удалось воспроизвести трек (короткий прогон). Попробуйте другую ссылку.';
                      let updated = false;
                      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
                      if (!updated) await notifyOwner(guild.id, state, userId, msg);
                    } catch (e) {}
                  })();
                } catch (e) {}
              }
            } catch (e) { /* ignore */ }
            try { state.player.removeListener('stateChange', onShortPlayStateChange); } catch (e) {}
            try { if (goodTimer) { clearTimeout(goodTimer); goodTimer = null; } } catch (e) {}
          }
        } catch (e) { /* ignore */ }
      };

      state.player.once(AudioPlayerStatus.Playing, () => {
        try {
          goodTimer = setTimeout(() => {
            playedSuccessfully = true;
            try { state.player.removeListener('stateChange', onShortPlayStateChange); } catch (e) {}
            try { if (goodTimer) { clearTimeout(goodTimer); goodTimer = null; } } catch (e) {}
          }, MIN_GOOD_PLAY_MS);
        } catch (e) {}
      });

      state.player.on('stateChange', onShortPlayStateChange);
    } catch (e) { /* ignore monitor failures */ }

    state.player.once(AudioPlayerStatus.Idle, async () => {
      state.playing = false;
      // If we are in a retry flow, suppress normal idle handling (queue advance, release-after)
      if (state._inRetry) {
        state._inRetry = false;
        state.current = null;
        return;
      }
      // If a release-after request exists, clear owner and notify requester
      try {
        const releaseAfter = db.get(`musicReleaseAfter_${guild.id}`) || null;
        if (releaseAfter) {
          // clear owner in control record
          const panelKey = `musicControl_${guild.id}`;
          const panelRec = db.get(panelKey) || {};
          delete panelRec.owner;
          await db.set(panelKey, panelRec).catch(()=>{});
          // clear the release flag
          await db.set(`musicReleaseAfter_${guild.id}`, null).catch(()=>{});
          // update control/status message
          try { await updateControlMessageWithError(guild.id, state._client, '⏳ Плеер освобождён по запросу'); } catch (e) {}
          try { await _updateStatusChannel(guild.id, state._client); } catch (e) {}
          // notify requester
          try { const u = await (state._client && state._client.users ? state._client.users.fetch(releaseAfter).catch(()=>null) : null); if (u) await u.send(`Владелец освободил плеер на сервере **${guild.name}** — вы можете теперь воспользоваться им.`).catch(()=>null); } catch (e) {}
          // log to channel
          try { const logCh = state._client && state._client.channels ? await state._client.channels.fetch(LOG_CHANNEL_ID).catch(()=>null) : null; if (logCh) await logCh.send(`⏳ Автоматическое освобождение плеера для сервера **${guild.name}** по запросу <@${releaseAfter}>`); } catch (e) {}
        }
      } catch (e) { console.warn('release-after check failed', e && e.message ? e.message : e); }

      // handle repeat/shuffle settings
      try {
        const settings = getSettings(guild.id) || {};
        const repeat = settings.repeat || false;
        const shuffle = settings.shuffle || false;

        if (repeat && state.current && state.current.url) {
          // replay same track
          const replayQuery = state.current.url || state.current.title;
          // small delay to avoid tight loop
          setTimeout(() => {
            try { playNow(guild, voiceChannel, replayQuery, textChannel, state.current && state.current.owner ? state.current.owner : null); } catch (e) {}
          }, 300);
          return;
        }

        // clear current and advance queue
        state.current = null;
        if (state.queue.length > 0) {
          let next = null;
          if (shuffle) {
            const idx = Math.floor(Math.random() * state.queue.length);
            next = state.queue.splice(idx, 1)[0];
          } else {
            next = state.queue.shift();
          }
          await saveQueueForGuild(guild.id);
          // pass along the guild owner as null for queued items
          playNow(guild, voiceChannel, next.query, textChannel, userId);
        }
      } catch (e) {
        console.warn('idle handler repeat/shuffle failed', e && e.message);
      }
      // do NOT destroy voice connection here; keep it connected until stop() is called
    });

    try {
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const okMsg = `▶️ Запущен: ${displayUrl}`;
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, okMsg).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, okMsg);
      const cfg = require('../config');
      const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930';
      const client = guild.client || (voiceChannel && voiceChannel.guild && voiceChannel.guild.client);
      if (client && announce) {
        try { const ch = await client.channels.fetch(announce).catch(() => null); if (ch) await ch.send(`▶️ [Музыка] ${guild.name}: ${displayUrl}`); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    return true;
  } catch (e) { console.error('playNow error', e && e.message ? e.message : e);
    try {
      const clientForPanel = (players.get(guild.id) && players.get(guild.id)._client) ? players.get(guild.id)._client : (guild && guild.client ? guild.client : null);
      const msg = '❌ Ошибка при воспроизведении.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msg);
    } catch (ee) { /* ignore */ }
    return false; }
}

async function addToQueue(guild, query) {
  const state = ensureState(guild.id);
  state.queue.push({ query });
  await saveQueueForGuild(guild.id);
  try {
    const cfg = require('../config');
    const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930';
    const client = guild.client;
    if (client && announce) { /* suppressed public announce: ➕ В очередь */ }
  } catch (e) { /* ignore */ }
  return state.queue.length;
}

async function stop(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try {
    // Set a flag to prevent auto-reconnect on ffmpeg exit
    state._userRequestedStop = true;
    
    state.player.stop(true);
    state.queue = [];
    state.playing = false;
    state.current = null;
    state._radioRetries = {}; // Clear any pending retries
    
    // Kill any child processes/streams associated with this guild
    try { _killStateProcs(state); } catch (e) {}
    await saveQueueForGuild(guild.id);
    const conn = getVoiceConnection(guild.id);
    if (conn) conn.destroy();
    state.connection = null;
    // clear progress updater
    try { if (state._progressInterval) { clearInterval(state._progressInterval); state._progressInterval = null; } } catch (e) {}
    
    // Update control message with stop status
    const client = guild.client;
    updateControlMessageWithError(guild.id, client, '⏹ Плейер остановлен').catch(() => {
      // Fallback: post to announce channel if control message update failed
      try { const cfg = require('../config'); const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930'; if (client && announce) { const ch = client.channels.fetch(announce).catch(() => null).then(ch => { if (ch) ch.send(`⏹ Плейер остановлен (сервер: ${guild.name})`); }); } } catch (e) {}
    });
    return true;
  } catch (e) { console.error('stop error', e); return false; }
}

async function skip(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try {
    try { if (state._progressInterval) { clearInterval(state._progressInterval); state._progressInterval = null; } } catch (e) {}
    state.player.stop();
    return true;
  } catch (e) { console.error('skip error', e); return false; }
}

function isPlaying(guild) { const state = players.get(guild.id); return state && state.playing; }

async function changeVolume(guild, delta) { const state = players.get(guild.id); if (!state) return null; state.volume = Math.max(0.01, Math.min(5.0, (state.volume || 1.0) + delta)); try { await saveQueueForGuild(guild.id); return state.volume; } catch (e) { return state.volume; } }

async function pause(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try { state.player.pause(); return true; } catch (e) { console.error('pause error', e); return false; }
}

async function resume(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try { state.player.unpause(); return true; } catch (e) { console.error('resume error', e); return false; }
}

async function playRadio(guild, voiceChannel, radioStream, textChannel, userId) {
  try {
    const state = ensureState(guild.id);
    // Store client for later use (error handlers, etc)
    state._client = guild.client;
    // Clear the stop flag when starting new playback
    state._userRequestedStop = false;

    // Owner check: if someone else owns the player, deny interruption
    try {
      if (state && state.current && state.current.owner && userId && state.current.owner !== String(userId)) {
        const owner = state.current.owner;
        const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
        const msgText = `❌ Плеер занят пользователем <@${owner}>. Дождитесь завершения или попросите его остановить.`;
        let updated = false;
        if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
        if (!updated) await notifyOwner(guild.id, state, userId, msgText);
        return false;
      }
    } catch (e) { /* ignore */ }

    // allowed to proceed: cleanup previous procs/streams
    try { _killStateProcs(state); } catch (e) {}
    // If another user currently owns the player, deny interruption
    const callerId = (textChannel && textChannel.client && textChannel.client.user) ? null : null;
    try {
      // radio owner check will be handled via radio play invocation (pass userId there if needed)
    } catch (e) {}
    const { url } = radioStream;
    if (!url) {
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = '❌ Неверный URL радиостанции.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }
    
    // Get or create connection
    let connection = getVoiceConnection(guild.id);
    if (!connection) {
      console.log('playRadio: Creating new voice connection');
      connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
      state.connection = connection;
      
      // CRITICAL: Wait for connection to be Ready BEFORE doing anything
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        console.log('playRadio: Voice connection is Ready');
      } catch (e) {
        console.error('playRadio: Connection never became Ready:', e && e.message);
        {
          const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
          const msgText = '❌ Ошибка подключения к голосовому каналу.';
          let updated = false;
          if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
          if (!updated) await notifyOwner(guild.id, state, userId, msgText);
        }
        return false;
      }
    } else {
      console.log('playRadio: Using existing voice connection');
    }

    // Subscribe immediately after ensuring connection is ready
    try {
      connection.subscribe(state.player);
      console.log('playRadio: Connection subscribed to player');
    } catch (e) {
      console.warn('playRadio: subscribe failed', e && e.message);
    }

    // Always use ffmpeg for radio to ensure proper codec and stability
    let resource = null;
    try {
      // Prefer system ffmpeg first; fallback to FFMPEG_PATH if system binary missing
      let ff = null;
      const spawnFfmpeg = (bin) => spawn(bin, [
        '-i', url,
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });

      try {
        ff = spawnFfmpeg('ffmpeg');
      } catch (e) {
        console.warn('playRadio: spawn system ffmpeg failed, will try fallback if configured', e && e.message);
      }
      if (!ff && process.env.FFMPEG_PATH) {
        try { ff = spawnFfmpeg(process.env.FFMPEG_PATH); } catch (e) { console.error('playRadio: spawn fallback ffmpeg failed', e && e.message); }
      }
      if (!ff) throw new Error('No ffmpeg available');

      // Log ffmpeg stderr
      ff.stderr.on('data', (data) => {
        console.warn('ffmpeg stderr:', String(data).slice(0, 200));
      });

      ff.on('error', (e) => {
        console.error('ffmpeg process error:', e && e.message);
      });

      // track ffmpeg in state procs for cleanup and watch exit
      try { if (state && state._procs) state._procs.push(ff); } catch (e) {}

      // If ffmpeg exits unexpectedly, log and attempt limited reconnects
      ff.on('exit', (code, signal) => {
        console.warn('ffmpeg exited with code', code, 'signal', signal);
        try { if (state && state.player) { state.player.stop(); state.playing = false; } } catch (e) {}

        // If user explicitly stopped the player, do NOT reconnect
        if (state._userRequestedStop) {
          console.log('playRadio: User requested stop, not reconnecting');
          return;
        }

        state._radioRetries = state._radioRetries || {};
        const key = String(url);
        state._radioRetries[key] = (state._radioRetries[key] || 0) + 1;
        const maxRetries = 2;
        if (state._radioRetries[key] <= maxRetries) {
          setTimeout(() => { try { playRadio(guild, voiceChannel, radioStream, textChannel, state.current && state.current.owner ? state.current.owner : null); } catch (e) {} }, 3000);
        } else {
          console.error('playRadio: Max reconnect attempts reached for', url.substring(0, 80));
          // Try to update control message; fallback to text channel send
          updateControlMessageWithError(guild.id, state._client, '❌ Я запутался повтори запрос.').then(ok => {
            if (!ok) console.warn('[PLAYER] suppressed public message: ❌ Я запутался повтори запрос.');
          }).catch(() => {
            console.warn('[PLAYER] suppressed public message: ❌ Я запутался повтори запрос.');
          });
        }
        // ensure any abandoned procs are cleaned
        try { _killStateProcs(state); } catch (e) {}
      });

      // Create audio resource from ffmpeg stdout
      resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
      console.log('playRadio: Audio resource created from ffmpeg stream');
    } catch (e) {
      console.error('playRadio: ffmpeg setup failed', e && e.message);
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = `❌ Ошибка: Не удалось запустить радио.`;
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }

    try {
      if (resource && resource.volume) resource.volume.setVolume(state.volume || 1.0);
    } catch (e) { console.warn('playRadio: volume set failed', e && e.message); }

    state.player.stop();
    try {
      state.player.play(resource);
      console.log('playRadio: Playing radio stream');
    } catch (e) {
      console.error('playRadio: player.play failed', e && e.message);
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msgText = `❌ Ошибка при запуске плеера.`;
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msgText).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msgText);
      return false;
    }
    
    state.playing = true;
    state.current = { url, title: 'Radio Stream', owner: userId ? String(userId) : null, type: 'radio' };
    
    state.player.once(AudioPlayerStatus.Idle, async () => {
      state.playing = false;
      state.current = null;
      // keep voice connection alive; radio may be restarted later or explicitly stopped
    });
    
    return true;
  } catch (e) { console.error('playRadio error', e && e.message);
    try {
      const clientForPanel = (state && state._client) ? state._client : (guild && guild.client ? guild.client : null);
      const msg = '❌ Ошибка при воспроизведении радио.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msg);
    } catch (ee) { /* ignore */ }
    return false; }
}

// ==================== ИСТОРИЯ, ИЗБРАННОЕ, ПЛЕЙЛИСТЫ ====================

// Добавить трек в историю
async function addToHistory(guildId, userId, trackData) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.history = music.history || {};
    const key = `${guildId}_${userId}`;
    music.history[key] = music.history[key] || [];
    // Последние 20 треков
    music.history[key].unshift({ ...trackData, timestamp: Date.now() });
    music.history[key] = music.history[key].slice(0, 20);
    await db.set('music', music);
  } catch (e) { console.warn('addToHistory failed', e && e.message); }
}

// Получить историю
async function getHistory(guildId, userId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    return (music.history && music.history[key]) || [];
  } catch (e) { return []; }
}

// Добавить в избранное
async function addToFavorites(guildId, userId, trackData) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.favorites = music.favorites || {};
    const key = `${guildId}_${userId}`;
    music.favorites[key] = music.favorites[key] || [];
    // Избегаем дубликатов по URL
    if (!music.favorites[key].some(t => t.url === trackData.url)) {
      music.favorites[key].push({ ...trackData, addedAt: Date.now() });
    }
    await db.set('music', music);
    return true;
  } catch (e) { console.warn('addToFavorites failed', e && e.message); return false; }
}

// Получить избранное
function getFavorites(guildId, userId) {
  try {
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    return (music.favorites && music.favorites[key]) || [];
  } catch (e) { return []; }
}

// Удалить из избранного
async function removeFromFavorites(guildId, userId, trackUrl) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.favorites && music.favorites[key]) {
      music.favorites[key] = music.favorites[key].filter(t => t.url !== trackUrl);
      await db.set('music', music);
      return true;
    }
    return false;
  } catch (e) { console.warn('removeFromFavorites failed', e && e.message); return false; }
}

// Создать плейлист
async function createPlaylist(guildId, userId, playlistName) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.playlists = music.playlists || {};
    const key = `${guildId}_${userId}`;
    music.playlists[key] = music.playlists[key] || {};
    
    const id = `pl_${Date.now()}`;
    music.playlists[key][id] = { name: playlistName, tracks: [], createdAt: Date.now() };
    await db.set('music', music);
    return id;
  } catch (e) { console.warn('createPlaylist failed', e && e.message); return null; }
}

// Добавить трек в плейлист
async function addTrackToPlaylist(guildId, userId, playlistId, trackData) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key] && music.playlists[key][playlistId]) {
      // Максимум 100 треков в плейлисте
      if ((music.playlists[key][playlistId].tracks || []).length < 100) {
        music.playlists[key][playlistId].tracks = music.playlists[key][playlistId].tracks || [];
        if (!music.playlists[key][playlistId].tracks.some(t => t.url === trackData.url)) {
          music.playlists[key][playlistId].tracks.push(trackData);
        }
        await db.set('music', music);
        return true;
      }
    }
    return false;
  } catch (e) { console.warn('addTrackToPlaylist failed', e && e.message); return false; }
}

// Получить плейлисты пользователя
function getPlaylists(guildId, userId) {
  try {
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    return (music.playlists && music.playlists[key]) || {};
  } catch (e) { return {}; }
}

// Удалить плейлист
async function deletePlaylist(guildId, userId, playlistId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key] && music.playlists[key][playlistId]) {
      delete music.playlists[key][playlistId];
      await db.set('music', music);
      return true;
    }
    return false;
  } catch (e) { console.warn('deletePlaylist failed', e && e.message); return false; }
}

// Удалить трек из плейлиста
async function removeTrackFromPlaylist(guildId, userId, playlistId, trackUrl) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key] && music.playlists[key][playlistId]) {
      music.playlists[key][playlistId].tracks = (music.playlists[key][playlistId].tracks || []).filter(t => t.url !== trackUrl);
      await db.set('music', music);
      return true;
    }
    return false;
  } catch (e) { console.warn('removeTrackFromPlaylist failed', e && e.message); return false; }
}

// Получить последний трек для восстановления
function getLastTrack(guildId) {
  try {
    const music = db.get('music') || {};
    music.lastTracks = music.lastTracks || {};
    return music.lastTracks[guildId] || null;
  } catch (e) { return null; }
}

// Сохранить последний трек
async function saveLastTrack(guildId, trackData) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.lastTracks = music.lastTracks || {};
    music.lastTracks[guildId] = trackData;
    await db.set('music', music);
  } catch (e) { console.warn('saveLastTrack failed', e && e.message); }
}

// Улучшенный поиск с фильтрацией
async function enhancedSearch(query, options = {}) {
  try {
    const { artist = null, album = null, year = null } = options;
    let r = await yts(query);
    let vids = r && r.videos ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    
    // Фильтр по году если указан
    if (year && vids.length > 0) {
      vids = vids.filter(v => {
        const vidYear = v.ago ? new Date(v.ago).getFullYear() : null;
        return !vidYear || vidYear === parseInt(year);
      });
    }
    
    // Фильтр по названию артиста в результатах
    if (artist && vids.length > 0) {
      vids = vids.filter(v => (v.author && v.author.name) ? v.author.name.toLowerCase().includes(artist.toLowerCase()) : true);
    }
    
    return vids.map(v => ({ url: v.url, title: v.title, author: v.author && v.author.name ? v.author.name : 'Unknown' }));
  } catch (e) { 
    console.warn('enhancedSearch failed', e && e.message);
    return [];
  }
}

// Получить рекомендации (похожие видео)
async function getRecommendations(query, limit = 5) {
  try {
    const r = await yts(`${query} mix similar`);
    const vids = r && r.videos ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    return vids.slice(0, limit).map(v => ({ url: v.url, title: v.title }));
  } catch (e) {
    console.warn('getRecommendations failed', e && e.message);
    return [];
  }
}

// Увеличить достижение
async function unlockAchievement(userId, achievementKey) {
  try {
    await db.ensureReady();
    const achievements = db.get('achievements') || {};
    achievements[userId] = achievements[userId] || {};
    if (!achievements[userId][achievementKey]) {
      achievements[userId][achievementKey] = { unlockedAt: Date.now(), count: 1 };
    } else {
      achievements[userId][achievementKey].count = (achievements[userId][achievementKey].count || 1) + 1;
    }
    await db.set('achievements', achievements);
  } catch (e) { console.warn('unlockAchievement failed', e && e.message); }
}

// Получить достижения
function getAchievements(userId) {
  try {
    const achievements = db.get('achievements') || {};
    return achievements[userId] || {};
  } catch (e) { return {}; }
}

// Получить персональные плейлисты только пользователя
async function getUserPersonalPlaylists(guildId, userId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key]) {
      return music.playlists[key];
    }
    return {};
  } catch (e) { console.warn('getUserPersonalPlaylists failed', e && e.message); return {}; }
}

// Запустить весь плейлист
async function playPlaylist(guild, voiceChannel, guildId, userId, playlistId, textChannel) {
  try {
    const playlists = await getUserPersonalPlaylists(guildId, userId);
    const playlist = playlists[playlistId];
    if (!playlist || !playlist.tracks || playlist.tracks.length === 0) {
      try {
        const clientForPanel = (guild && guild.client) ? guild.client : null;
        const msg = '❌ Плейлист пуст или не найден.';
        let updated = false;
        if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
        if (!updated) await notifyOwner(guild.id, state, userId, msg);
      } catch (e) { /* ignore */ }
      return false;
    }
    let played = false;
    for (let i = 0; i < playlist.tracks.length; i++) {
      const track = playlist.tracks[i];
      if (i === 0) {
        await playNow(guild, voiceChannel, track.url || track.title, textChannel, userId);
        played = true;
      } else {
        await addToQueue(guild, track.url || track.title);
      }
    }
    if (played) {
      try {
        const clientForPanel = (guild && guild.client) ? guild.client : null;
        const msg = `✅ Запущен плейлист **${playlist.name}** (${playlist.tracks.length} песен)`;
        let updated = false;
        if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
        if (!updated) await notifyOwner(guild.id, state, userId, msg);
      } catch (e) { /* ignore */ }
    }
    return played;
  } catch (e) {
    console.error('playPlaylist error:', e && e.message ? e.message : e);
    try {
      const clientForPanel = (guild && guild.client) ? guild.client : null;
      const msg = '❌ Ошибка при запуске плейлиста.';
      let updated = false;
      if (clientForPanel) updated = await updateControlMessageWithError(guild.id, clientForPanel, msg).catch(() => false);
      if (!updated) await notifyOwner(guild.id, state, userId, msg);
    } catch (ee) {}
    return false;
  }
}

// Remove track by index from playlist
async function removeTrackByIndex(guildId, userId, playlistId, index) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key] && music.playlists[key][playlistId]) {
      const tracks = music.playlists[key][playlistId].tracks || [];
      if (index >= 0 && index < tracks.length) {
        tracks.splice(index, 1);
        music.playlists[key][playlistId].tracks = tracks;
        await db.set('music', music);
        return true;
      }
    }
    return false;
  } catch (e) { console.warn('removeTrackByIndex failed', e && e.message); return false; }
}

// Move track within playlist
async function moveTrackInPlaylist(guildId, userId, playlistId, fromIndex, toIndex) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    const key = `${guildId}_${userId}`;
    if (music.playlists && music.playlists[key] && music.playlists[key][playlistId]) {
      const tracks = music.playlists[key][playlistId].tracks || [];
      if (fromIndex >= 0 && fromIndex < tracks.length && toIndex >= 0 && toIndex <= tracks.length) {
        const [item] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, item);
        music.playlists[key][playlistId].tracks = tracks;
        await db.set('music', music);
        return true;
      }
    }
    return false;
  } catch (e) { console.warn('moveTrackInPlaylist failed', e && e.message); return false; }
}

// Toggle repeat (boolean) for guild
async function toggleRepeat(guildId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.settings = music.settings || {};
    const st = music.settings[guildId] || {};
    st.repeat = !st.repeat;
    music.settings[guildId] = st;
    await db.set('music', music);
    return st.repeat;
  } catch (e) { console.warn('toggleRepeat failed', e && e.message); return false; }
}

// Toggle shuffle (boolean) for guild
async function toggleShuffle(guildId) {
  try {
    await db.ensureReady();
    const music = db.get('music') || {};
    music.settings = music.settings || {};
    const st = music.settings[guildId] || {};
    st.shuffle = !st.shuffle;
    music.settings[guildId] = st;
    await db.set('music', music);
    return st.shuffle;
  } catch (e) { console.warn('toggleShuffle failed', e && e.message); return false; }
}

function getSettings(guildId) {
  try { const music = db.get('music') || {}; music.settings = music.settings || {}; return music.settings[guildId] || {}; } catch (e) { return {}; }
}

// Получить топ песен за неделю
async function getWeeklyTopTracks(guildId, limit = 10) {
  try {
    return await musicLogger.getWeeklyTopTracks(guildId, limit);
  } catch (e) {
    console.error('getWeeklyTopTracks error:', e.message);
    return [];
  }
}

// Получить логи музыки
async function getMusicLogs(guildId, limit = 50) {
  try {
    return await musicLogger.getMusicLogs(guildId, limit);
  } catch (e) {
    console.error('getMusicLogs error:', e.message);
    return [];
  }
}

// Получить текущий трек для гильдии (если есть)
function getCurrentTrack(guildId) {
  try {
    const state = players.get(guildId);
    if (!state) return null;
    return state.current || null;
  } catch (e) { console.error('getCurrentTrack failed', e && e.message); return null; }
}

function getQueue(guildId) {
  try {
    const state = players.get(guildId);
    if (!state) return [];
    return Array.isArray(state.queue) ? state.queue : [];
  } catch (e) { console.error('getQueue failed', e && e.message); return []; }
}

function getProgress(guildId) {
  try {
    const state = players.get(guildId);
    if (!state || !state.current) return { elapsed: 0, duration: 0 };
    const duration = state.current.durationMs || 0;
    const elapsed = state._progressElapsed || (state._progressStart ? (Date.now() - state._progressStart) : 0);
    return { elapsed: Math.max(0, elapsed), duration: duration };
  } catch (e) { console.error('getProgress failed', e && e.message); return { elapsed: 0, duration: 0 }; }
}

module.exports = { 
  playNow, playRadio, addToQueue, stop, skip, isPlaying, changeVolume, findYouTubeUrl,
  addToHistory, getHistory, addToFavorites, getFavorites, removeFromFavorites,
  createPlaylist, addTrackToPlaylist, getPlaylists, deletePlaylist, removeTrackFromPlaylist,
  getLastTrack, saveLastTrack, enhancedSearch, getRecommendations,
  unlockAchievement, getAchievements, getUserPersonalPlaylists, playPlaylist,
  getWeeklyTopTracks, getMusicLogs, pause, resume, getCurrentTrack, getQueue,
  removeTrackByIndex, moveTrackInPlaylist, toggleRepeat, toggleShuffle, getSettings
  , getProgress
};
