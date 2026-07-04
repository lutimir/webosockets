import { createClient } from "@synckit/client";
import { LiveCursors, RoomProvider, SyncKitProvider } from "@synckit/react";
import { useMemo } from "react";

import { Board } from "./Board.js";
import { currentUser, wsUrl } from "./config.js";

export function App() {
  const user = useMemo(currentUser, []);
  const client = useMemo(
    () =>
      createClient({
        url: wsUrl(),
        tokenProvider: async () => {
          const params = new URLSearchParams({ user: user.id, name: user.name });
          const response = await fetch(`/api/token?${params}`);
          if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);
          const { token } = (await response.json()) as { token: string };
          return token;
        },
      }),
    [user],
  );

  return (
    <SyncKitProvider client={client}>
      <RoomProvider id="demo-board" initialPresence={{ cursor: null }}>
        <Board user={user} />
        <LiveCursors />
      </RoomProvider>
    </SyncKitProvider>
  );
}
