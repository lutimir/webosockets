import { parseServerMessage, type ServerMessage } from "@synckit/core";
import { type FastifyInstance } from "fastify";
import { WebSocket } from "ws";

export function listenAddress(app: FastifyInstance): string {
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("no listen address");
  return `127.0.0.1:${address.port}`;
}

/** Thin WS client for protocol tests: records messages, awaits by type. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  closeCode: number | undefined;
  private waiters: {
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw: Buffer) => {
      const parsed = parseServerMessage(raw.toString("utf8"));
      if (!parsed.ok) throw new Error(`server sent invalid message: ${parsed.error}`);
      this.messages.push(parsed.message);
      this.waiters = this.waiters.filter((waiter) => {
        if (!waiter.predicate(parsed.message)) return true;
        waiter.resolve(parsed.message);
        return false;
      });
    });
    this.socket.on("close", (code) => {
      this.closeCode = code;
    });
  }

  static connect(app: FastifyInstance, token?: string): Promise<TestClient> {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const client = new TestClient(`ws://${listenAddress(app)}/v1/realtime${query}`);
    return new Promise((resolve, reject) => {
      client.socket.once("open", () => resolve(client));
      client.socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the first (buffered or future) message matching. */
  waitFor<T extends ServerMessage["type"]>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const matches = (m: ServerMessage): m is Extract<ServerMessage, { type: T }> =>
      m.type === type && predicate(m as Extract<ServerMessage, { type: T }>);

    const buffered = this.messages.find(matches);
    if (buffered) return Promise.resolve(buffered);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"`)),
        timeoutMs,
      );
      this.waiters.push({
        predicate: matches,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  waitForClose(timeoutMs = 5_000): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs);
      this.socket.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
