import { act, render, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SyncKitProvider, RoomProvider } from "./context.js";
import {
  useComments,
  useMyPresence,
  useNotifications,
  useOthers,
  useUpdateMyPresence,
} from "./hooks.js";
import { createFake, fakeNotification, presenceEntry } from "./testing/fake.js";

function wrapperFor(fake: ReturnType<typeof createFake>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SyncKitProvider client={fake.client}>
        <RoomProvider id="fake-room">{children}</RoomProvider>
      </SyncKitProvider>
    );
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useOthers", () => {
  it("re-renders with presence changes", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useOthers(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => fake.controls.setOthers([presenceEntry("alice", { cursor: { x: 1, y: 2 } })]));
    expect(result.current.map((entry) => entry.endUserId)).toEqual(["alice"]);
  });

  it("with a selector, skips re-renders when the selected value is unchanged", async () => {
    const fake = createFake();
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useOthers((others) => others.length);
      },
      { wrapper: wrapperFor(fake) },
    );
    await waitFor(() => expect(result.current).toBe(0));
    const rendersAfterMount = renders;

    // Same count (1 → 1) — selected value unchanged, no re-render.
    act(() => fake.controls.setOthers([presenceEntry("alice", { v: 1 })]));
    expect(result.current).toBe(1);
    const rendersAfterFirst = renders;
    act(() => fake.controls.setOthers([presenceEntry("alice", { v: 2 })]));
    expect(renders).toBe(rendersAfterFirst);
    expect(rendersAfterFirst).toBeGreaterThan(rendersAfterMount);
  });
});

describe("useMyPresence & useUpdateMyPresence", () => {
  it("updates presence like setState", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useMyPresence(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current[0]).toBeNull());

    act(() => result.current[1]({ cursor: { x: 3, y: 4 } }));
    expect(result.current[0]).toEqual({ cursor: { x: 3, y: 4 } });
    expect(fake.controls.getMyPresence()).toEqual({ cursor: { x: 3, y: 4 } });
  });

  it("throttles rapid updates to one per window (leading + trailing)", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useUpdateMyPresence(60), {
      wrapper: wrapperFor(fake),
    });
    await waitFor(() => expect(result.current).toBeTypeOf("function"));

    vi.useFakeTimers();
    act(() => {
      for (let i = 0; i < 10; i++) result.current({ x: i });
    });
    // Leading call went through immediately…
    expect(fake.controls.getMyPresence()).toEqual({ x: 0 });
    // …and the trailing call carries the last value.
    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(fake.controls.getMyPresence()).toEqual({ x: 9 });
  });
});

describe("useComments", () => {
  it("loads, creates optimistically and reconciles with the server comment", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useComments(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.create({ body: "Hello" }));
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0]?.body).toBe("Hello");
    expect(result.current.comments[0]?.pending).toBeUndefined();
  });

  it("rolls the optimistic comment back when the server rejects it", async () => {
    const fake = createFake({ failCreates: true });
    const { result } = renderHook(() => useComments(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.create({ body: "Nope" })).rejects.toThrow("create failed");
    });
    expect(result.current.comments).toHaveLength(0);
    expect(result.current.error).toBe("create failed");
  });

  it("merges realtime created events without duplicates", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useComments(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const comment = {
      id: "00000000-0000-7000-8000-00000000c001",
      threadId: null,
      endUserId: "alice",
      body: "From realtime",
      anchor: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    act(() => fake.controls.pushCommentCreated(comment));
    act(() => fake.controls.pushCommentCreated(comment)); // duplicate event
    expect(result.current.comments).toHaveLength(1);
  });
});

describe("useNotifications", () => {
  it("collects notifications and tracks unread count", async () => {
    const fake = createFake();
    const { result } = renderHook(() => useNotifications(), { wrapper: wrapperFor(fake) });
    await waitFor(() => expect(result.current.unreadCount).toBe(0));

    act(() => {
      fake.controls.pushNotification(fakeNotification("n1"));
      fake.controls.pushNotification(fakeNotification("n2"));
    });
    expect(result.current.unreadCount).toBe(2);

    act(() => result.current.markRead(["n1"]));
    expect(result.current.unreadCount).toBe(1);

    act(() => result.current.markAllRead());
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications).toHaveLength(2);
  });
});

describe("RoomProvider lifecycle", () => {
  it("leaves the room on unmount", async () => {
    const fake = createFake();
    const leaveSpy = vi.spyOn(fake.room, "leave");
    const Wrapper = wrapperFor(fake);
    const { unmount, findByText } = render(<Wrapper>ready</Wrapper>);
    await findByText("ready");

    unmount();
    expect(leaveSpy).toHaveBeenCalled();
  });
});
