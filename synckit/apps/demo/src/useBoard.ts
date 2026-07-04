import { type JsonValue } from "@synckit/client";
import { useBroadcastEvent, useClient, useEventListener } from "@synckit/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { applyMove, seedBoard, type BoardState, type MoveOp } from "./board.js";

/**
 * Board state synced over SyncKit broadcasts. Moves apply optimistically on
 * the sender (the server does not echo broadcasts back to their author) and
 * every other client applies them on receipt. Late joiners say hello and
 * adopt the highest-revision state a peer replies with.
 */
export function useBoard(): { board: BoardState; move: (op: MoveOp) => void } {
  const client = useClient();
  const broadcast = useBroadcastEvent();
  const [board, setBoard] = useState<BoardState>(seedBoard);
  const boardRef = useRef(board);
  boardRef.current = board;
  const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEventListener("board:move", (payload) => {
    setBoard((current) => applyMove(current, payload as unknown as MoveOp));
  });

  // A newcomer asks for state; one peer answers after a small random delay.
  // Seeing anyone else's state reply cancels ours (no reply storm).
  useEventListener("board:hello", (_payload, from) => {
    if (from === client.endUserId) return;
    if (replyTimer.current !== undefined) clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(
      () => {
        broadcast("board:state", boardRef.current as unknown as JsonValue);
      },
      150 + Math.random() * 400,
    );
  });

  useEventListener("board:state", (payload) => {
    if (replyTimer.current !== undefined) {
      clearTimeout(replyTimer.current);
      replyTimer.current = undefined;
    }
    const incoming = payload as unknown as BoardState;
    setBoard((current) => (incoming.rev > current.rev ? incoming : current));
  });

  useEffect(() => {
    broadcast("board:hello", {});
    return () => {
      if (replyTimer.current !== undefined) clearTimeout(replyTimer.current);
    };
  }, [broadcast]);

  const move = useCallback(
    (op: MoveOp) => {
      setBoard((current) => applyMove(current, op));
      broadcast("board:move", op as unknown as JsonValue);
    },
    [broadcast],
  );

  return { board, move };
}
