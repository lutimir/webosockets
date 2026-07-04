import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";

import { RoomProvider, SyncKitProvider } from "../context.js";
import { createFake, fakeNotification, presenceEntry } from "../testing/fake.js";

import { CommentsThread } from "./CommentsThread.js";
import { LiveCursors } from "./LiveCursors.js";
import { NotificationInbox } from "./NotificationInbox.js";
import { PresenceAvatars } from "./PresenceAvatars.js";

/** Wraps a story in providers backed by the scriptable fake client. */
function MockSyncKit({
  children,
  setup,
}: {
  children: React.ReactNode;
  setup?: (fake: ReturnType<typeof createFake>) => void | (() => void);
}) {
  const fakeRef = useRef<ReturnType<typeof createFake> | null>(null);
  fakeRef.current ??= createFake({
    comments: [
      {
        id: "c-1",
        threadId: null,
        endUserId: "alice",
        body: "Can we ship this on Friday?",
        anchor: null,
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        resolvedAt: null,
      },
      {
        id: "c-2",
        threadId: "c-1",
        endUserId: "bob",
        body: "Backend is done — polishing the UI now.",
        anchor: null,
        createdAt: new Date(Date.now() - 1_800_000).toISOString(),
        resolvedAt: null,
      },
    ],
  });
  const fake = fakeRef.current;

  useEffect(() => setup?.(fake), [fake, setup]);

  return (
    <SyncKitProvider client={fake.client}>
      <RoomProvider id="fake-room">{children}</RoomProvider>
    </SyncKitProvider>
  );
}

const meta: Meta = {
  title: "SyncKit/Components",
};
export default meta;

export const Avatars: StoryObj = {
  render: () => (
    <MockSyncKit
      setup={(fake) =>
        fake.controls.setOthers([
          presenceEntry("alice", null, "Alice Novak"),
          presenceEntry("bob", null, "Bob Kovac"),
          presenceEntry("carol", null, "Carol Danko"),
          presenceEntry("dave", null, "Dave Urban"),
          presenceEntry("erin", null, "Erin Slavik"),
          presenceEntry("frank", null, "Frank Toth"),
        ])
      }
    >
      <PresenceAvatars max={4} />
    </MockSyncKit>
  ),
};

export const Cursors: StoryObj = {
  render: () => (
    <MockSyncKit
      setup={(fake) => {
        let t = 0;
        const timer = setInterval(() => {
          t += 0.08;
          fake.controls.setOthers([
            presenceEntry(
              "alice",
              { cursor: { x: 300 + Math.sin(t) * 180, y: 220 + Math.cos(t) * 120 } },
              "Alice",
            ),
            presenceEntry(
              "bob",
              { cursor: { x: 340 + Math.cos(t * 1.4) * 150, y: 240 + Math.sin(t * 0.8) * 100 } },
              "Bob",
            ),
          ]);
        }, 50);
        return () => clearInterval(timer);
      }}
    >
      <p style={{ font: "14px system-ui", color: "#71717a" }}>
        Two simulated collaborators moving their cursors.
      </p>
      <LiveCursors />
    </MockSyncKit>
  ),
};

export const Comments: StoryObj = {
  render: () => (
    <MockSyncKit>
      <CommentsThread />
    </MockSyncKit>
  ),
};

export const Inbox: StoryObj = {
  render: () => (
    <MockSyncKit
      setup={(fake) => {
        fake.controls.pushNotification(fakeNotification("n-1"));
        fake.controls.pushNotification(fakeNotification("n-2"));
        fake.controls.pushNotification(fakeNotification("n-3", new Date().toISOString()));
      }}
    >
      <NotificationInbox />
    </MockSyncKit>
  ),
};
