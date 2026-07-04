/** Demo identity: pick a user with ?user=alice|bob|carol (default: guest). */

export interface DemoUser {
  id: string;
  name: string;
}

const KNOWN_USERS: Record<string, string> = {
  alice: "Alice Novak",
  bob: "Bob Kovac",
  carol: "Carol Danko",
};

export function currentUser(): DemoUser {
  const requested = new URLSearchParams(window.location.search).get("user");
  if (requested && KNOWN_USERS[requested]) {
    return { id: requested, name: KNOWN_USERS[requested] };
  }
  if (requested) return { id: requested, name: requested };
  // Stable anonymous identity per tab.
  const stored = sessionStorage.getItem("synckit-demo-user");
  const id = stored ?? `guest-${Math.random().toString(36).slice(2, 7)}`;
  sessionStorage.setItem("synckit-demo-user", id);
  return { id, name: `Guest ${id.slice(-4)}` };
}

export const DEMO_USERS = Object.keys(KNOWN_USERS);

declare const __SYNCKIT_WS_URL__: string;

export function wsUrl(): string {
  if (__SYNCKIT_WS_URL__) return __SYNCKIT_WS_URL__;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:4000/v1/realtime`;
}
