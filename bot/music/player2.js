const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus, getVoiceConnection, entersState, VoiceConnectionStatus, StreamType } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
let playdl = null;
try { playdl = require('play-dl'); } catch (e) { playdl = null; }
const { exec, spawn } = require('child_process');
const db = require('../libs/db');
const { Readable, PassThrough } = require('stream');

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
    let vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    
    // Try adding 'audio' keyword if nothing found
    if (!vids.length) {
      r = await yts(`${searchQuery} audio`);
      vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    }
    
    // Try broader search if still empty
    if (!vids.length) {
      r = await yts(query.split('?')[0].split('/').pop() || query);
      vids = r && r.videos && r.videos.length ? r.videos.filter(v => !v.live && v.seconds > 0) : [];
    }
    
    // Fallback to any video results if still empty
    if (!vids.length && r && r.videos && r.videos.length) vids = r.videos;

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
    const cmd = `yt-dlp -f "bestaudio" -g "${url.replace(/"/g, '\\"')}" 2>&1`;
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err || !stdout || stdout.includes('ERROR')) {
        console.warn('yt-dlp failed:', err && err.message, 'stderr:', stderr || '');
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
          try {
            // Wait for the underlying voice connection to become ready
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
          } catch (e) {
            console.warn('joinVoiceChannel: connection not ready', e && e.message);
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
        try {
          resource = createAudioResource(stream, { inputType: StreamType.WebmOpus, inlineVolume: true });
        } catch (err) {
          resource = createAudioResource(stream, { inlineVolume: true });
        }
        resolvedUrl = url;
      }
    } else if (url && Array.isArray(url.candidates)) {
      for (const c of url.candidates) {
        candidates.push(c.url || c);
      }
    }

    if (candidates.length > 0) {
      const attempted = [];
      const attemptDetails = [];
      let lastErr = null;
      // iterate candidates sequentially
      for (const candidateUrl of candidates) {
        attempted.push(candidateUrl);
        const detail = { candidate: candidateUrl, attempts: [] };

        // 1) Try play-dl FIRST (most reliable against YouTube blocking)
        if (!resource && playdl) {
          try {
            console.log('Attempting play-dl for', candidateUrl.substring(0, 80));
            let pl = null;
            try {
              pl = await playdl.stream(candidateUrl);
            } catch (e) {
              console.warn('play-dl.stream() threw:', String(e && e.message || e).slice(0, 150));
              pl = null;
            }
            
            if (pl && pl.stream) {
              resource = createAudioResource(pl.stream, { inlineVolume: true });
              resolvedUrl = candidateUrl;
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

        // 2) DISABLED: ytdl-core
        // Reason: YouTube actively blocks it, causes "Could not extract functions" error
        // Even with error handlers, ytdl-core throws uncaught exceptions during async stream reading
        // Only play-dl is used now - if it fails, we need a different approach (API, proxy, etc)
        if (!resource) {
          // Do not attempt ytdl-core - it will crash the bot
          detail.attempts.push({ method: 'ytdl-core', ok: false, error: 'disabled - YouTube blocks it' });
        }

        if (!resource) {
          attemptDetails.push(detail);
        } else {
          break;
        }
      }

      if (!resource) {
        console.error('All music candidates failed:', attempted);
        // Short error message to avoid Discord 2000 char limit
        const msg = `❌ Ошибка: Не удалось получить аудиопоток. Попробуйте другую песню.`;
        if (textChannel && textChannel.send) await textChannel.send(msg);
        return false;
      }
    }

    if (resource && resource.volume) resource.volume.setVolume(state.volume || 1.0);

    state.player.stop();
    try {
      state.player.play(resource);
    } catch (e) {
      console.error('playNow: player.play() failed:', e && e.message);
      if (textChannel && textChannel.send) await textChannel.send('❌ Ошибка при запуске плеера.');
      return false;
    }
    connection.subscribe(state.player);
    state.playing = true;
    
    // Use resolvedUrl for display (it's the actual YouTube URL we used)
    const displayUrl = resolvedUrl && typeof resolvedUrl === 'string' ? resolvedUrl : (typeof url === 'string' ? url : 'Музыка');
    state.current = { url: displayUrl, title: displayUrl };

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
      if (textChannel && textChannel.send) await textChannel.send(`▶️ Запущен: ${displayUrl}`);
      const cfg = require('../config');
      const announce = cfg.musicLogChannelId || cfg.announceChannelId || '1436487981723680930';
      const client = guild.client || (voiceChannel && voiceChannel.guild && voiceChannel.guild.client);
      if (client && announce) {
        try { const ch = await client.channels.fetch(announce).catch(() => null); if (ch) await ch.send(`▶️ [Музыка] ${guild.name}: ${displayUrl}`); } catch (e) { /* ignore */ }
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

async function playRadio(guild, voiceChannel, radioStream, textChannel) {
  try {
    const state = ensureState(guild.id);
    const { url } = radioStream;
    if (!url) {
      if (textChannel && textChannel.send) await textChannel.send('❌ Неверный URL радиостанции.');
      return false;
    }
    let connection = getVoiceConnection(guild.id);
    if (!connection) {
      connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
      state.connection = connection;
    }

    // Always use ffmpeg for radio to ensure proper codec and stability
    let resource = null;
    try {
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
      console.log('playRadio: Starting ffmpeg decode for', url.substring(0, 80));
      
      const ff = spawn(ffmpegPath, [
        '-i', url,
        '-vn',                 // no video
        '-f', 's16le',         // raw PCM format
        '-ar', '48000',        // 48kHz sample rate
        '-ac', '2',            // stereo
        'pipe:1'               // write to stdout
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024  // 10MB buffer
      });

      // Log ffmpeg errors
      ff.stderr.on('data', (data) => {
        console.warn('ffmpeg stderr:', String(data).slice(0, 200));
      });

      // Subscribe connection before creating resource
      connection.subscribe(state.player);

      // Create audio resource from ffmpeg stdout
      resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw, inlineVolume: true });
      console.log('playRadio: Audio resource created from ffmpeg stream');
    } catch (e) {
      console.error('playRadio: ffmpeg setup failed', e && e.message);
      if (textChannel && textChannel.send) await textChannel.send(`❌ Ошибка: Не удалось запустить радио.`);
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
      if (textChannel && textChannel.send) await textChannel.send(`❌ Ошибка при запуске плеера.`);
      return false;
    }
    
    state.playing = true;
    state.current = { url, title: 'Radio Stream' };
    
    state.player.once(AudioPlayerStatus.Idle, async () => {
      state.playing = false;
      state.current = null;
      setTimeout(() => { const conn = getVoiceConnection(guild.id); if (conn) conn.destroy(); state.connection = null; }, 30_000);
    });
    
    return true;
  } catch (e) { console.error('playRadio error', e && e.message); if (textChannel && textChannel.send) await textChannel.send('❌ Ошибка при воспроизведении радио.'); return false; }
}

module.exports = { playNow, playRadio, addToQueue, stop, skip, isPlaying, changeVolume };
