/**
 * First-minutes capture: when the bot joins a server, every production log line about that server
 * for the next 30 minutes is collected and posted to the Hub #logs channel as one block when the
 * window closes. LeeAnn reads a new server's first few minutes of runtime logs to see how an admin
 * finds their way around, and Coolify throws those logs away on every Redeploy (2026-11-19).
 *
 * Kept in memory only, so a restart during the window loses that capture. Deliberately free of
 * imports from utilities.js, which calls captureLogLine() from inside log().
 */

export const FIRST_MINUTES_CAPTURE_MINUTES = 30;

// guildId -> { guildName, lines: string[], timer }
const captures = new Map();

/**
 * Starts a capture for a guild that just added the bot. onClose(guildId, guildName, lines) runs
 * once when the window ends. Starting again for a guild already being captured does nothing.
 */
export function startFirstMinutesCapture(guildId, guildName, onClose, minutes = FIRST_MINUTES_CAPTURE_MINUTES) {
  const id = String(guildId);
  if (captures.has(id)) return false;
  const entry = { guildName, lines: [], timer: null };
  entry.timer = setTimeout(() => {
    captures.delete(id);
    Promise.resolve(onClose(id, entry.guildName, entry.lines)).catch(() => {});
  }, minutes * 60 * 1000);
  entry.timer.unref?.();
  captures.set(id, entry);
  return true;
}

/**
 * Called by log() for every line it prints. A line belongs to a capture when its guildName option
 * is that server's name, or its text contains that server's id (several join and setup lines
 * carry only the id).
 */
export function captureLogLine(line, guildName = null) {
  if (!captures.size) return;
  for (const [id, entry] of captures) {
    if ((guildName && guildName === entry.guildName) || line.includes(id)) {
      entry.lines.push(line);
    }
  }
}

/** For tests: drops every open capture without running onClose. */
export function clearFirstMinutesCaptures() {
  for (const entry of captures.values()) clearTimeout(entry.timer);
  captures.clear();
}
