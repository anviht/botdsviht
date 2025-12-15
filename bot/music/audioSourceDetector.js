/**
 * Audio Source Detector and Handler
 * Detects the source of audio (YouTube, Spotify, Soundcloud, Yandex, HTTP stream)
 * and provides the appropriate handler to retrieve playable stream/URL
 */

const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Try loading optional libraries
let spotifyUri = null;
let soundcloudScraper = null;
let playdl = null;

try { playdl = require('play-dl'); } catch (e) {}
try { spotifyUri = require('spotify-uri'); } catch (e) {}
try { soundcloudScraper = require('soundcloud-scraper'); } catch (e) {}

/**
 * Detects the audio source type from a query or URL
 * @param {string} query - User query or URL
 * @returns {object} - { type: 'youtube'|'spotify'|'soundcloud'|'yandex'|'http'|'text_search', source: queryOrUrl, metadata: {...} }
 */
function detectSource(query) {
  if (!query) return { type: 'unknown', error: 'Empty query' };

  const lowerQuery = query.toLowerCase().trim();

  // Spotify URL patterns
  if (lowerQuery.includes('spotify.com') || lowerQuery.startsWith('spotify:')) {
    const spotifyMatch = query.match(/(?:spotify\.com\/track\/|spotify:track:)([a-zA-Z0-9]+)/);
    if (spotifyMatch && spotifyMatch[1]) {
      return {
        type: 'spotify',
        trackId: spotifyMatch[1],
        source: query,
        metadata: { detected: true }
      };
    }
    const playlistMatch = query.match(/(?:spotify\.com\/playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
    if (playlistMatch && playlistMatch[1]) {
      return {
        type: 'spotify',
        playlistId: playlistMatch[1],
        source: query,
        metadata: { type: 'playlist', detected: true }
      };
    }
    const albumMatch = query.match(/(?:spotify\.com\/album\/|spotify:album:)([a-zA-Z0-9]+)/);
    if (albumMatch && albumMatch[1]) {
      return {
        type: 'spotify',
        albumId: albumMatch[1],
        source: query,
        metadata: { type: 'album', detected: true }
      };
    }
  }

  // Soundcloud URL pattern
  if (lowerQuery.includes('soundcloud.com')) {
    return {
      type: 'soundcloud',
      source: query,
      metadata: { detected: true }
    };
  }

  // Yandex.Music URL pattern
  if (lowerQuery.includes('music.yandex') || lowerQuery.includes('я.музыка')) {
    const yandexMatch = query.match(/music\.yandex\.ru\/album\/(\d+)\/track\/(\d+)|я\.музыка\/album\/(\d+)\/track\/(\d+)/);
    if (yandexMatch) {
      return {
        type: 'yandex',
        source: query,
        metadata: { detected: true }
      };
    }
    return { type: 'yandex', source: query, metadata: { detected: true } };
  }

  // YouTube URL patterns
  if (lowerQuery.includes('youtube.com') || lowerQuery.includes('youtu.be')) {
    const youtubeMatch = query.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (youtubeMatch && youtubeMatch[1]) {
      return {
        type: 'youtube',
        videoId: youtubeMatch[1],
        source: query,
        metadata: { detected: true }
      };
    }
  }

  // HTTP URL pattern (direct stream)
  if (lowerQuery.startsWith('http://') || lowerQuery.startsWith('https://')) {
    // Check if it's a known service that wasn't caught above
    if (!lowerQuery.includes('youtube') && !lowerQuery.includes('spotify') && 
        !lowerQuery.includes('soundcloud') && !lowerQuery.includes('yandex')) {
      return {
        type: 'http',
        url: query,
        source: query,
        metadata: { detected: true }
      };
    }
  }

  // Default to text search on YouTube
  return {
    type: 'text_search',
    query: query,
    metadata: { defaultSearch: true }
  };
}

/**
 * Handles Spotify track/album/playlist
 * Currently returns search fallback to YouTube (proper Spotify requires API key)
 */
async function handleSpotify(detection) {
  try {
    // Note: Real Spotify integration would require API credentials
    // For now, search for track on YouTube using the track ID or metadata
    const query = detection.source;
    
    // Extract track info if possible, otherwise use the full URL as search
    let searchQuery = query;
    if (detection.trackId) {
      // Could use spotify-uri to get metadata if available
      searchQuery = `spotify track ${detection.trackId}`;
    } else if (detection.albumId) {
      searchQuery = `spotify album ${detection.albumId}`;
    }

    console.log(`[Spotify] Falling back to YouTube search for: ${searchQuery}`);
    
    // Use yt-search or play-dl to find the track on YouTube
    if (playdl) {
      try {
        const results = await playdl.search(searchQuery, { limit: 5 }).catch(() => []);
        if (results && results.length > 0) {
          return {
            success: true,
            type: 'youtube_from_spotify',
            url: results[0].url,
            title: results[0].title,
            source: detection.source
          };
        }
      } catch (e) {
        console.warn('[Spotify] play-dl search failed:', e.message);
      }
    }

    // Fallback: return error
    return {
      success: false,
      error: 'Spotify integration requires API credentials. Please search for the track by name on YouTube.'
    };
  } catch (e) {
    console.error('[Spotify] Handler error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Handles Soundcloud URLs
 * Uses soundcloud-scraper or falls back to yt-dlp
 */
async function handleSoundcloud(detection) {
  try {
    const url = detection.source;
    
    // Try soundcloud-scraper if available
    if (soundcloudScraper) {
      try {
        // Download track metadata and stream URL
        const track = await soundcloudScraper.getTrack(url).catch(() => null);
        if (track && track.streamable) {
          return {
            success: true,
            type: 'soundcloud_stream',
            url: track.url || url,
            title: track.title,
            source: url
          };
        }
      } catch (e) {
        console.warn('[Soundcloud] soundcloud-scraper failed:', e.message);
      }
    }

    // Fallback: use yt-dlp to extract stream
    try {
      const { stdout } = await execAsync(`yt-dlp -f "audio/best" -g "${url.replace(/"/g, '\\"')}"`, { timeout: 15000 });
      const streamUrl = stdout.trim().split('\n')[0];
      if (streamUrl) {
        return {
          success: true,
          type: 'soundcloud_ytdlp',
          url: streamUrl,
          source: url
        };
      }
    } catch (e) {
      console.warn('[Soundcloud] yt-dlp failed:', e.message);
    }

    return {
      success: false,
      error: 'Could not extract Soundcloud stream. Library not available.'
    };
  } catch (e) {
    console.error('[Soundcloud] Handler error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Handles Yandex.Music URLs
 * Uses yt-dlp to extract audio stream
 */
async function handleYandex(detection) {
  try {
    const url = detection.source;

    // Use yt-dlp to extract stream (Yandex.Music is supported by yt-dlp)
    try {
      const { stdout } = await execAsync(`yt-dlp -f "audio/best" -g "${url.replace(/"/g, '\\"')}"`, { timeout: 15000 });
      const streamUrl = stdout.trim().split('\n')[0];
      if (streamUrl) {
        return {
          success: true,
          type: 'yandex_stream',
          url: streamUrl,
          source: url
        };
      }
    } catch (e) {
      console.warn('[Yandex] yt-dlp failed:', e.message);
    }

    return {
      success: false,
      error: 'Could not extract Yandex.Music stream. yt-dlp may not be installed.'
    };
  } catch (e) {
    console.error('[Yandex] Handler error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Handles direct HTTP streams (MP3, M3U8, OGG, etc.)
 * Validates the URL and checks if it's accessible
 */
async function handleHTTP(detection) {
  try {
    const url = detection.source;

    // Validate URL is accessible
    try {
      const response = await axios.head(url, { timeout: 5000 });
      const contentType = response.headers['content-type'] || '';
      
      // Check if content type is audio
      const isAudio = contentType.includes('audio') || 
                      url.match(/\.(mp3|m3u8|ogg|wav|flac|aac|opus)(\?|$)/i);

      if (isAudio || response.status === 200) {
        return {
          success: true,
          type: 'http_stream',
          url: url,
          contentType: contentType,
          source: url
        };
      }
    } catch (e) {
      console.warn('[HTTP] HEAD request failed, trying GET:', e.message);
      
      // Try GET request if HEAD fails
      try {
        const response = await axios.get(url, { 
          timeout: 5000,
          headers: { Range: 'bytes=0-0' } // Only fetch first byte to validate
        });
        return {
          success: true,
          type: 'http_stream',
          url: url,
          contentType: response.headers['content-type'] || '',
          source: url
        };
      } catch (e2) {
        console.warn('[HTTP] GET request also failed:', e2.message);
      }
    }

    return {
      success: false,
      error: 'Could not access HTTP stream URL'
    };
  } catch (e) {
    console.error('[HTTP] Handler error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Handles YouTube text search or video URL
 * Uses play-dl or ytdl-core to get video/audio stream
 */
async function handleYouTube(detection) {
  try {
    let query = detection.query || detection.videoId || detection.source;
    
    // If it's a video ID, construct full URL
    if (detection.videoId) {
      query = `https://www.youtube.com/watch?v=${detection.videoId}`;
    }

    // Try play-dl first (more reliable)
    if (playdl) {
      try {
        // If it's already a URL, stream directly; if it's a search query, search first
        let toPlay = query;
        
        if (!query.startsWith('http')) {
          // Text search
          const results = await playdl.search(query, { limit: 1 }).catch(() => []);
          if (results && results.length > 0) {
            toPlay = results[0].url;
          }
        }

        const stream = await playdl.stream(toPlay).catch(() => null);
        if (stream && stream.stream) {
          return {
            success: true,
            type: 'youtube_stream',
            url: toPlay,
            stream: stream.stream,
            source: query
          };
        }
      } catch (e) {
        console.warn('[YouTube] play-dl failed:', e.message);
      }
    }

    // Fallback to ytdl-core
    if (ytdl) {
      try {
        if (!query.startsWith('http')) {
          // For text searches, try searching on YouTube first
          const yts = require('yt-search');
          const results = await yts(query);
          if (results.videos && results.videos.length > 0) {
            const vid = results.videos[0];
            query = vid.url;
          }
        }

        const stream = ytdl(query, { quality: 'highestaudio' });
        return {
          success: true,
          type: 'youtube_ytdl',
          url: query,
          stream: stream,
          source: query
        };
      } catch (e) {
        console.warn('[YouTube] ytdl-core failed:', e.message);
      }
    }

    return {
      success: false,
      error: 'Could not get YouTube stream'
    };
  } catch (e) {
    console.error('[YouTube] Handler error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Main entry point: detects source and returns playable stream/URL
 * @param {string} queryOrUrl - User input (search query, URL, or link)
 * @returns {object} - { success: bool, type: string, url?: string, stream?: object, error?: string }
 */
async function getAudioStream(queryOrUrl) {
  try {
    console.log('[AudioSourceDetector] Processing:', queryOrUrl.substring(0, 100));
    
    const detection = detectSource(queryOrUrl);
    console.log('[AudioSourceDetector] Detected type:', detection.type);

    let result = null;

    switch (detection.type) {
      case 'spotify':
        result = await handleSpotify(detection);
        break;
      case 'soundcloud':
        result = await handleSoundcloud(detection);
        break;
      case 'yandex':
        result = await handleYandex(detection);
        break;
      case 'http':
        result = await handleHTTP(detection);
        break;
      case 'youtube':
      case 'text_search':
        result = await handleYouTube(detection);
        break;
      default:
        result = {
          success: false,
          error: `Unknown source type: ${detection.type}`
        };
    }

    return result;
  } catch (e) {
    console.error('[AudioSourceDetector] Fatal error:', e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

module.exports = {
  detectSource,
  getAudioStream,
  handleYouTube,
  handleSpotify,
  handleSoundcloud,
  handleYandex,
  handleHTTP
};
