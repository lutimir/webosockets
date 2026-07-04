import {
  NotificationInbox,
  PresenceAvatars,
  useConnectionStatus,
  useUpdateMyPresence,
} from "@synckit/react";
import { useState, type DragEvent } from "react";

import { CardComments } from "./CardComments.js";
import { type Card, type Column } from "./board.js";
import { DEMO_USERS, type DemoUser } from "./config.js";
import { useBoard } from "./useBoard.js";

export function Board({ user }: { user: DemoUser }) {
  const { board, move } = useBoard();
  const status = useConnectionStatus();
  const updatePresence = useUpdateMyPresence();
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <div
      className="demo-root"
      onPointerMove={(event) => updatePresence({ cursor: { x: event.clientX, y: event.clientY } })}
      onPointerLeave={() => updatePresence({ cursor: null })}
    >
      <header className="demo-header">
        <div className="demo-brand">
          <span className="demo-logo">◍</span>
          <div>
            <h1>Product Board</h1>
            <p>Powered by SyncKit — open this URL in a second tab to collaborate</p>
          </div>
        </div>
        <div className="demo-toolbar">
          <span className={`demo-status demo-status-${status}`}>{status}</span>
          <PresenceAvatars max={5} />
          <NotificationInbox />
          <nav className="demo-users">
            {DEMO_USERS.map((id) => (
              <a
                key={id}
                href={`?user=${id}`}
                className={id === user.id ? "demo-user demo-user-active" : "demo-user"}
              >
                {id}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="demo-board">
        {board.columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={column.cardIds
              .map((id) => board.cards[id])
              .filter((card): card is Card => card !== undefined)}
            dragging={dragging}
            onDragStart={setDragging}
            onDrop={(cardId, toIndex) => {
              move({ cardId, toColumnId: column.id, toIndex });
              setDragging(null);
            }}
          />
        ))}
      </main>
    </div>
  );
}

function BoardColumn({
  column,
  cards,
  dragging,
  onDragStart,
  onDrop,
}: {
  column: Column;
  cards: Card[];
  dragging: string | null;
  onDragStart: (cardId: string | null) => void;
  onDrop: (cardId: string, toIndex: number) => void;
}) {
  const [over, setOver] = useState(false);

  const dropAt = (event: DragEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    const cardId = event.dataTransfer.getData("text/synckit-card");
    if (cardId) onDrop(cardId, index);
  };

  return (
    <section
      className={over ? "demo-column demo-column-over" : "demo-column"}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => dropAt(event, cards.length)}
    >
      <h2>
        {column.title} <span className="demo-count">{cards.length}</span>
      </h2>
      <div className="demo-cards">
        {cards.map((card, index) => (
          <BoardCard
            key={card.id}
            card={card}
            faded={dragging === card.id}
            onDragStart={() => onDragStart(card.id)}
            onDragEnd={() => onDragStart(null)}
            onDropBefore={(event) => dropAt(event, index)}
          />
        ))}
      </div>
    </section>
  );
}

function BoardCard({
  card,
  faded,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  card: Card;
  faded: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: (event: DragEvent) => void;
}) {
  return (
    <article
      className={faded ? "demo-card demo-card-faded" : "demo-card"}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/synckit-card", card.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDrop={onDropBefore}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="demo-card-top">
        <span className={`demo-tag demo-tag-${card.tag}`}>{card.tag}</span>
        <CardComments cardId={card.id} />
      </div>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
    </article>
  );
}
