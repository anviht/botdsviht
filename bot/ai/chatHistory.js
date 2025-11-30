/**
 * Chat history manager per user
 * Stores message history for each user to provide context to the AI
 */

class ChatHistory {
  constructor() {
    // { userId: { role: 'user'|'assistant', content: '...' }, ... }
    this.userHistories = new Map();
    this.maxHistoryPerUser = 20; // Keep last 20 messages per user
  }

  /**
   * Add a message to user's history
   * @param {string} userId - Discord user ID
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
  addMessage(userId, role, content) {
    if (!userId || !role || !content) return;

    if (!this.userHistories.has(userId)) {
      this.userHistories.set(userId, []);
    }

    const history = this.userHistories.get(userId);
    history.push({ role, content, timestamp: Date.now() });

    // Keep only last N messages to avoid context bloat
    if (history.length > this.maxHistoryPerUser) {
      history.shift();
    }
  }

  /**
   * Get user's full conversation history
   * @param {string} userId - Discord user ID
   * @returns {Array} Array of { role, content } objects
   */
  getHistory(userId) {
    if (!this.userHistories.has(userId)) {
      return [];
    }
    return this.userHistories.get(userId).map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  /**
   * Clear history for a user (optional: for /reset or similar commands)
   * @param {string} userId - Discord user ID
   */
  clearHistory(userId) {
    if (this.userHistories.has(userId)) {
      this.userHistories.delete(userId);
    }
  }

  /**
   * Get stats about stored histories
   */
  getStats() {
    const total = Array.from(this.userHistories.values()).reduce((sum, h) => sum + h.length, 0);
    return {
      usersWithHistory: this.userHistories.size,
      totalMessages: total
    };
  }
}

module.exports = new ChatHistory();
