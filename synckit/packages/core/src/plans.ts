export type PlanId = "free" | "pro" | "scale" | "enterprise";

export interface PlanLimits {
  /** Monthly active end users included in the plan. */
  maxMau: number;
  /** Concurrent realtime connections across the whole project. */
  maxConcurrentConnections: number;
  /** null = unlimited. */
  maxProjects: number | null;
  /** Days of comment history retained; null = unlimited. */
  commentHistoryDays: number | null;
  priceEurMonthly: number;
  /** Price per MAU above maxMau (metered); undefined = hard limit. */
  mauOveragePricePerUnitEur?: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    maxMau: 100,
    maxConcurrentConnections: 10,
    maxProjects: 1,
    commentHistoryDays: 30,
    priceEurMonthly: 0,
  },
  pro: {
    maxMau: 1_000,
    maxConcurrentConnections: 100,
    maxProjects: 5,
    commentHistoryDays: null,
    priceEurMonthly: 49,
    mauOveragePricePerUnitEur: 0.05,
  },
  scale: {
    maxMau: 10_000,
    maxConcurrentConnections: 1_000,
    maxProjects: null,
    commentHistoryDays: null,
    priceEurMonthly: 299,
  },
  // Custom contracts — effectively no self-serve limits.
  enterprise: {
    maxMau: Number.MAX_SAFE_INTEGER,
    maxConcurrentConnections: Number.MAX_SAFE_INTEGER,
    maxProjects: null,
    commentHistoryDays: null,
    priceEurMonthly: 0,
  },
};

/** Plans purchasable through self-serve checkout. */
export const CHECKOUT_PLANS = ["pro", "scale"] as const satisfies readonly PlanId[];
