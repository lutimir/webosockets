/** Board domain: seed data + pure operations, shared by every client. */

export interface Card {
  id: string;
  title: string;
  description: string;
  tag: string;
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

export interface BoardState {
  columns: Column[];
  cards: Record<string, Card>;
  /** Monotonic revision — the highest one wins when states are compared. */
  rev: number;
}

export interface MoveOp {
  cardId: string;
  toColumnId: string;
  toIndex: number;
}

const card = (id: string, title: string, description: string, tag: string): Card => ({
  id,
  title,
  description,
  tag,
});

/** Deterministic seed — every client starts from the same board. */
export function seedBoard(): BoardState {
  const cards = [
    card("card-1", "Realtime presence API", "Ship cursors + avatars to GA.", "core"),
    card("card-2", "Threaded comments", "Replies, resolve, anchors on any element.", "core"),
    card("card-3", "Notification inbox", "In-app inbox fed by mention events.", "growth"),
    card("card-4", "Webhooks v2", "HMAC signatures + retry with backoff.", "platform"),
    card("card-5", "Usage-based billing", "Stripe meters for MAU overage.", "billing"),
    card("card-6", "React SDK docs", "Quickstart under 10 minutes.", "docs"),
    card("card-7", "Self-hosting guide", "Compose file + zero-downtime deploy.", "docs"),
    card("card-8", "Load test 2k conns", "p95 < 150 ms presence fan-out.", "platform"),
  ];
  return {
    columns: [
      { id: "todo", title: "Todo", cardIds: ["card-5", "card-6", "card-7"] },
      { id: "in-progress", title: "In progress", cardIds: ["card-3", "card-4", "card-8"] },
      { id: "done", title: "Done", cardIds: ["card-1", "card-2"] },
    ],
    cards: Object.fromEntries(cards.map((item) => [item.id, item])),
    rev: 0,
  };
}

/** Applies a move immutably; unknown ids leave the board untouched. */
export function applyMove(board: BoardState, op: MoveOp): BoardState {
  if (!board.cards[op.cardId]) return board;
  if (!board.columns.some((column) => column.id === op.toColumnId)) return board;

  const columns = board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== op.cardId),
  }));
  const target = columns.find((column) => column.id === op.toColumnId);
  if (!target) return board;
  const index = Math.max(0, Math.min(op.toIndex, target.cardIds.length));
  target.cardIds.splice(index, 0, op.cardId);

  return { ...board, columns, rev: board.rev + 1 };
}
