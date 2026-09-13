import type { Chat } from "./types";

const CHATS_KEY = "zaynchat.chats.v1";
const ACTIVE_KEY = "zaynchat.active.v1";

function isChat(value: unknown): value is Chat {
  const c = value as Chat;
  return (
    !!c &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    Array.isArray(c.messages)
  );
}

export function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChat);
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    // quota exceeded or storage disabled - nothing we can do, keep the UI alive
  }
}

export function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}
