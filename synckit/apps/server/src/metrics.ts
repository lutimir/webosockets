import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Process-wide Prometheus registry, exposed at GET /metrics. Module-level
 * singletons on purpose: one process = one exporter, and building several
 * Fastify apps in one process (tests) must not re-register collectors.
 */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const wsConnectionsActive = new Gauge({
  name: "synckit_ws_connections_active",
  help: "WebSocket connections currently registered on this instance",
  registers: [metricsRegistry],
});

export const wsMessagesTotal = new Counter({
  name: "synckit_ws_messages_total",
  help: "WebSocket messages processed, by direction",
  labelNames: ["direction"] as const,
  registers: [metricsRegistry],
});

export const wsClosesTotal = new Counter({
  name: "synckit_ws_closes_total",
  help: "WebSocket connections closed, by close code",
  labelNames: ["code"] as const,
  registers: [metricsRegistry],
});

export const wsDroppedMessagesTotal = new Counter({
  name: "synckit_ws_dropped_messages_total",
  help: "Messages dropped because of backpressure (slow consumers)",
  registers: [metricsRegistry],
});

export const fanoutSeconds = new Histogram({
  name: "synckit_broadcast_fanout_seconds",
  help: "Time to deliver one pub/sub envelope to all local room members",
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [metricsRegistry],
});

export const httpRequestSeconds = new Histogram({
  name: "synckit_http_request_duration_seconds",
  help: "REST request duration by route and status",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});
