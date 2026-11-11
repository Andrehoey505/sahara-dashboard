/**
 * The active server, remembered across restarts.
 *
 * Every moderation screen used to have its own hardcoded list of server names,
 * which meant a server the bot was in could never be picked and a name that no
 * longer existed could. The real list comes from /api/servers; this is only
 * which one the dashboard is currently pointed at.
 */

export type Server = {
  id: string;
  name: string;
  member_count?: number;
  icon?: string | null;
  description?: string | null;
  owner_id?: string | null;
  prefix?: string;
  bot_admin?: boolean;
  can_moderate?: boolean;
  text_channels?: number;
  roles?: number;
};

const KEY = "sahara_active_server";

export function loadActiveServer(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function saveActiveServer(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
}

/** The chosen server if it still exists, otherwise the first one. */
export function resolveActive(servers: Server[], chosen: string): string {
  if (chosen && servers.some((s) => s.id === chosen)) return chosen;
  return servers[0]?.id || "";
}

export function serverName(servers: Server[], id: string): string {
  return servers.find((s) => s.id === id)?.name || "";
}
