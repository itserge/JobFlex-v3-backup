export type RevenuePoint = { date: string; mrr: number | null; arr: number | null; collected: number | null; daily: number | null; forecastMrr: number | null; forecastArr: number | null; forecastCollected: number | null };
export type RevenueCustomer = { id: string; name: string; email: string; plans: string; status: string; paymentMethod: string; monthly: number; collected: number; refunded: number; overdue: number; nextDate: string | null; nextAmount: number | null; forecast: string };
export type RevenueReport = {
  asOf: string; currency: string; live: boolean; mrr: number; arr: number; collected: number; gross: number; refunds: number;
  projectedMrr: number; projectedCollected: number; eligibleTrials: number; excludedTrials: number; overdue: number;
  points: RevenuePoint[]; customers: RevenueCustomer[]; warnings: string[];
  /** The page shows a saved read while a new one runs behind it (lib/revenueSaved). */
  updating?: boolean;
};
export const revenueDate = (seconds: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(seconds * 1000));
