import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SyncKitProvider, RoomProvider } from "../context.js";
import { createFake, fakeNotification, presenceEntry } from "../testing/fake.js";

import { CommentsThread } from "./CommentsThread.js";
import { LiveCursors } from "./LiveCursors.js";
import { NotificationInbox } from "./NotificationInbox.js";
import { PresenceAvatars } from "./PresenceAvatars.js";

function Providers({
  fake,
  children,
}: {
  fake: ReturnType<typeof createFake>;
  children: ReactNode;
}) {
  return (
    <SyncKitProvider client={fake.client}>
      <RoomProvider id="fake-room">{children}</RoomProvider>
    </SyncKitProvider>
  );
}

describe("PresenceAvatars", () => {
  it("shows up to `max` avatars and an overflow chip", async () => {
    const fake = createFake();
    render(
      <Providers fake={fake}>
        <PresenceAvatars max={2} />
      </Providers>,
    );
    await waitFor(() => screen.getByRole("group"));

    act(() =>
      fake.controls.setOthers([
        presenceEntry("alice", null, "Alice Novak"),
        presenceEntry("bob", null, "Bob Kovac"),
        presenceEntry("carol", null, "Carol Danko"),
        presenceEntry("dave", null, "Dave Urban"),
      ]),
    );

    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("4 people online");
    expect(screen.getByTitle("Alice Novak").textContent).toBe("AN");
    expect(screen.getByTitle("Bob Kovac")).toBeDefined();
    expect(screen.queryByTitle("Carol Danko")).toBeNull();
    expect(screen.getByTitle("2 more").textContent).toBe("+2");
  });
});

describe("LiveCursors", () => {
  it("renders a named cursor for members with cursor presence", async () => {
    const fake = createFake();
    render(
      <Providers fake={fake}>
        <LiveCursors />
      </Providers>,
    );
    await waitFor(() => expect(fake.controls.getMyPresence()).toBeNull());

    act(() =>
      fake.controls.setOthers([
        presenceEntry("alice", { cursor: { x: 100, y: 50 } }, "Alice"),
        presenceEntry("bob", { cursor: null }, "Bob"), // no cursor → not rendered
      ]),
    );

    expect(screen.getByTestId("cursor-alice").textContent).toContain("Alice");
    expect(screen.queryByTestId("cursor-bob")).toBeNull();
  });
});

describe("CommentsThread", () => {
  it("creates a comment through the composer and replies in a thread", async () => {
    const user = userEvent.setup();
    const fake = createFake();
    render(
      <Providers fake={fake}>
        <CommentsThread />
      </Providers>,
    );
    await waitFor(() => screen.getByLabelText("Add a comment"));

    await user.type(screen.getByLabelText("Add a comment"), "First comment");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("First comment")).toBeDefined());

    // Reply in the thread (Ctrl+Enter submits the focused composer).
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(screen.getByLabelText("Reply…"), "A reply");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(screen.getByText("A reply")).toBeDefined());
    expect(fake.controls.getComments()).toHaveLength(2);
    expect(fake.controls.getComments()[1]?.threadId).toBe(fake.controls.getComments()[0]?.id);
  });

  it("resolves a comment via the toggle button", async () => {
    const user = userEvent.setup();
    const fake = createFake({
      comments: [
        {
          id: "c-root",
          threadId: null,
          endUserId: "alice",
          body: "Resolve me",
          anchor: null,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        },
      ],
    });
    render(
      <Providers fake={fake}>
        <CommentsThread />
      </Providers>,
    );
    await waitFor(() => screen.getByText("Resolve me"));

    const toggle = screen.getByRole("button", { name: "Resolve" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolved ✓" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });
});

describe("NotificationInbox", () => {
  it("shows the unread badge, opens the panel and marks all read", async () => {
    const user = userEvent.setup();
    const fake = createFake();
    render(
      <Providers fake={fake}>
        <NotificationInbox />
      </Providers>,
    );
    await waitFor(() => screen.getByRole("button", { name: "Notifications" }));

    act(() => {
      fake.controls.pushNotification(fakeNotification("n1"));
      fake.controls.pushNotification(fakeNotification("n2"));
    });
    expect(screen.getByTestId("unread-badge").textContent).toBe("2");

    await user.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    expect(screen.getByRole("region", { name: "Notifications" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.queryByTestId("unread-badge")).toBeNull();

    // Escape closes the panel.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });
});
