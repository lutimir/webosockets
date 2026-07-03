import { type JsonValue } from "@synckit/client";
import { type Room, type SyncKitClient } from "@synckit/client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { ValueStore } from "./store.js";

interface SyncKitContextValue {
  client: SyncKitClient;
}

interface RoomContextValue {
  room: Room;
  /** Mirror of my presence so useMyPresence can re-render on updates. */
  myPresence: ValueStore<JsonValue | null>;
}

const SyncKitContext = createContext<SyncKitContextValue | null>(null);
const RoomContext = createContext<RoomContextValue | null>(null);

/** Provides the SyncKit client to the tree and manages its connection. */
export function SyncKitProvider({
  client,
  children,
}: {
  client: SyncKitClient;
  children: ReactNode;
}) {
  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);
  return <SyncKitContext.Provider value={{ client }}>{children}</SyncKitContext.Provider>;
}

/** Joins a room for the lifetime of the subtree. */
export function RoomProvider({
  id,
  initialPresence,
  children,
}: {
  id: string;
  initialPresence?: JsonValue;
  children: ReactNode;
}) {
  const client = useClient();
  const [value, setValue] = useState<RoomContextValue | null>(null);

  useEffect(() => {
    const room = client.joinRoom(id, {
      ...(initialPresence !== undefined ? { initialPresence } : {}),
    });
    setValue({ room, myPresence: new ValueStore(room.presence.getMy()) });
    return () => {
      setValue(null);
      void room.leave();
    };
    // initialPresence is intentionally only read on join.
  }, [client, id]);

  if (!value) return null;
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useClient(): SyncKitClient {
  const context = useContext(SyncKitContext);
  if (!context) throw new Error("useClient must be used inside <SyncKitProvider>");
  return context.client;
}

export function useRoomContext(): RoomContextValue {
  const context = useContext(RoomContext);
  if (!context) throw new Error("this hook must be used inside <RoomProvider>");
  return context;
}

/** The Room handle for imperative access (escape hatch). */
export function useRoom(): Room {
  return useRoomContext().room;
}
