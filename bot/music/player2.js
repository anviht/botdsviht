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
        connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        state.connection = connection;
      }

    let resource = null;
    if (isYouTubeUrl(url)) {
      // If findYouTubeUrl returned candidates object, try them sequentially
      const attempted = [];
      try {
        // If callers passed an object with candidates, iterate; otherwise use the single url
        const candidates = (typeof url === 'string') ? [{ url }] : (url.candidates || []);
        let lastErr = null;
        for (const c of candidates) {
          const candidateUrl = c.url || c;
          attempted.push(candidateUrl);
          try {
            // verify info first
            await ytdl.getInfo(candidateUrl);
            // try high quality then low quality
            let stream = null;
            try { stream = ytdl(candidateUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 }); } catch (e) { stream = null; }
            if (!stream) {
              try { stream = ytdl(candidateUrl, { filter: 'audioonly', quality: 'lowestaudio', highWaterMark: 1 << 25 }); } catch (e) { stream = null; }
            }
            if (!stream) throw new Error('ytdl failed to create stream');
            resource = createAudioResource(stream, { inlineVolume: true });
            // success
            url = candidateUrl;
            break;
          } catch (err) {
            lastErr = err;
            console.warn('ytdl candidate failed', candidateUrl, err && err.message);
            continue;
          }
        }
        if (!resource) {
          // try play-dl fallback if available
          if (playdl) {
            for (const c of attempted) {
              try {
                const pl = await playdl.stream(c).catch(() => null);
                if (pl && pl.stream) {
                  resource = createAudioResource(pl.stream, { inlineVolume: true });
                  url = c;
                  break;
                }
              } catch (ee) {
                console.warn('play-dl candidate failed', c, ee && ee.message);
                continue;
              }
            }
          }
          // If still no resource, try yt-dlp via npx to get direct audio URL
          if (!resource) {
            for (const c of attempted) {
              try {
                const candidate = c;
                const cmd = `npx -y yt-dlp -f bestaudio -g ${JSON.stringify(candidate)}`;
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
                    url = candidate;
                    break;
                  }
                }
              } catch (ee) {
                console.warn('yt-dlp candidate failed', c, ee && ee.message);
                continue;
              }
            }
          }
          if (!resource) throw lastErr || new Error('No ytdl candidate succeeded');
        }
      } catch (e) {
        console.error('ytdl stream error', e && e.stack ? e.stack : e && e.message ? e.message : e);
        if (textChannel && textChannel.send) await textChannel.send('❌ Ошибка при получении аудиопотока с YouTube. Попробуйте другой запрос или ссылку.');
        return false;
      }
    } else {
      const stream = await streamFromUrl(url);
      if (!stream) { if (textChannel && textChannel.send) await textChannel.send('❌ Не удалось открыть поток.'); return false; }
      resource = createAudioResource(stream, { inlineVolume: true });
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
