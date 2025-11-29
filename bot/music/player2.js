const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
let playdl = null;
try { playdl = require('play-dl'); } catch (e) { playdl = null; }
const { exec } = require('child_process');
const db = require('../libs/db');

// single in-memory state map
const players = new Map();

function ensureState(guildId) {
  if (!players.has(guildId)) {
    players.set(guildId, {
      connection: null,
      player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
      queue: [],
      volume: 1.0,
      playing: false,
      current: null
    });
  }
  return players.get(guildId);
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

async function findYouTubeUrl(query) {
  if (!query) return null;
  if (/^https?:\/\//i.test(query)) return query;
  try {
    // Try direct search and collect candidates
    let r = await yts(query);
    let vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    // Try adding 'audio' keyword if nothing found
    if (!vids.length) {
      r = await yts(`${query} audio`);
      vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    }
    // Fallback to any video results if still empty
    if (!vids.length && r && r.videos && r.videos.length) vids = r.videos;
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
    const res = await fetch(url);
    if (!res || !res.body) throw new Error('No response body');
    return res.body;
  } catch (e) { console.warn('streamFromUrl failed', e && e.message); return null; }
}

async function playNow(guild, voiceChannel, queryOrUrl, textChannel) {
  try {
    const state = ensureState(guild.id);
    const url = await findYouTubeUrl(queryOrUrl);
    if (!url) {
      if (textChannel && textChannel.send) await textChannel.send('❌ Не удалось найти трек по запросу.');
      return false;
    }

      let connection = getVoiceConnection(guild.id);
      if (!connection) {
        try {
          connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
          state.connection = connection;
        } catch (e) {
          console.error('Failed to join voice channel', e && e.message ? e.message : e);
          if (textChannel && textChannel.send) await textChannel.send('❌ Не удалось подключиться к голосовому каналу. Проверьте права бота (Connect/Speak).');
          return false;
        }
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
        if (!stream) { if (textChannel && textChannel.send) await textChannel.send('❌ Не удалось открыть поток.'); return false; }
        resource = createAudioResource(stream, { inlineVolume: true });
        resolvedUrl = url;
      }
    } else if (url && Array.isArray(url.candidates)) {
      for (const c of url.candidates) {
        candidates.push(c.url || c);
      }
    }

    if (candidates.length > 0) {
      const attempted = [];
      let lastErr = null;
      // announce attempt
      try { if (textChannel && textChannel.send) await textChannel.send(`🔎 Ищу поток для: ${queryOrUrl}`); } catch (e) {}
      // iterate candidates sequentially; prefer play-dl first, then ytdl, then yt-dlp
      for (const candidateUrl of candidates) {
        attempted.push(candidateUrl);

        // 1) try play-dl first (if available)
        if (playdl) {
          try {
            const pl = await playdl.stream(candidateUrl).catch(() => null);
            if (pl && pl.stream) {
              resource = createAudioResource(pl.stream, { inlineVolume: true });
              resolvedUrl = candidateUrl;
              break;
            }
          } catch (e) { console.warn('play-dl failed for candidate', candidateUrl, e && e.message); lastErr = e; }
        }

        // 2) try ytdl
        try {
          await ytdl.getInfo(candidateUrl);
          let stream = null;
          try { stream = ytdl(candidateUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 }); } catch (e) { stream = null; }
          if (!stream) {
            try { stream = ytdl(candidateUrl, { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25 }); } catch (e) { stream = null; }
          }
          if (stream) {
            resource = createAudioResource(stream, { inlineVolume: true });
            resolvedUrl = candidateUrl;
            break;
          }
        } catch (e) { lastErr = e; console.warn('ytdl failed for candidate', candidateUrl, e && e.message); }

        // 3) try yt-dlp via npx to get direct audio URL
        try {
          const cmd = `npx -y yt-dlp -f bestaudio -g ${JSON.stringify(candidateUrl)}`;
          const direct = await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
              if (err) return reject(err);
              const out = (stdout || '').trim().split(/\r?\n/)[0];
              resolve(out || null);
            });
          }).catch(e => null);
          if (direct) {
            const s = await streamFromUrl(direct);
            if (s) {
              resource = createAudioResource(s, { inlineVolume: true });
              resolvedUrl = candidateUrl;
              break;
            }
          }
        } catch (e) { lastErr = e; console.warn('yt-dlp failed for candidate', candidateUrl, e && e.message); }
      }

      if (!resource) {
        console.error('All YouTube candidates failed:', attempted, lastErr && (lastErr.stack || lastErr.message || lastErr));
        if (textChannel && textChannel.send) await textChannel.send(`❌ Ошибка при получении аудиопотока с YouTube. Попытки: ${attempted.join(', ')}`);
        return false;
      }
    }

    resource.volume.setVolume(state.volume || 1.0);

    state.player.stop();
    state.player.play(resource);
    connection.subscribe(state.player);
    state.playing = true;
    state.current = { url, title: url };

    state.player.once(AudioPlayerStatus.Idle, async () => {
      state.playing = false;
      state.current = null;
      if (state.queue.length > 0) {
        const next = state.queue.shift();
        await saveQueueForGuild(guild.id);
        playNow(guild, voiceChannel, next.query, textChannel);
      } else {
        setTimeout(() => {
          const conn = getVoiceConnection(guild.id);
          if (conn) conn.destroy();
          state.connection = null;
        }, 30_000);
      }
    });

    try {
      if (textChannel && textChannel.send) await textChannel.send(`▶️ Запущен: ${url}`);
      const cfg = require('../config');
      const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930';
      const client = guild.client || (voiceChannel && voiceChannel.guild && voiceChannel.guild.client);
      if (client && announce) {
        try { const ch = await client.channels.fetch(announce).catch(() => null); if (ch) await ch.send(`▶️ [Музыка] ${guild.name}: ${url}`); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    return true;
  } catch (e) { console.error('playNow error', e && e.message ? e.message : e); if (textChannel && textChannel.send) await textChannel.send('❌ Ошибка при воспроизведении.'); return false; }
}

async function addToQueue(guild, query) {
  const state = ensureState(guild.id);
  state.queue.push({ query });
  await saveQueueForGuild(guild.id);
  try {
    const cfg = require('../config');
    const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930';
    const client = guild.client;
    if (client && announce) { const ch = await client.channels.fetch(announce).catch(() => null); if (ch) await ch.send(`➕ В очередь: ${query} (сервер: ${guild.name})`); }
  } catch (e) { /* ignore */ }
  return state.queue.length;
}

async function stop(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try {
    state.player.stop(true);
    state.queue = [];
    state.playing = false;
    state.current = null;
    await saveQueueForGuild(guild.id);
    const conn = getVoiceConnection(guild.id);
    if (conn) conn.destroy();
    state.connection = null;
    try { const cfg = require('../config'); const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930'; const client = guild.client; if (client && announce) { const ch = await client.channels.fetch(announce).catch(() => null); if (ch) await ch.send(`⏹ Плейер остановлен (сервер: ${guild.name})`); } } catch (e) {}
    return true;
  } catch (e) { console.error('stop error', e); return false; }
}

async function skip(guild) {
  const state = players.get(guild.id);
  if (!state) return false;
  try { state.player.stop(); return true; } catch (e) { console.error('skip error', e); return false; }
}

function isPlaying(guild) { const state = players.get(guild.id); return state && state.playing; }

async function changeVolume(guild, delta) { const state = players.get(guild.id); if (!state) return null; state.volume = Math.max(0.01, Math.min(5.0, (state.volume || 1.0) + delta)); try { await saveQueueForGuild(guild.id); return state.volume; } catch (e) { return state.volume; } }

module.exports = { playNow, addToQueue, stop, skip, isPlaying, changeVolume };
