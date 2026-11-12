/** `IEventSummary` (api-contracts.md); definitions in SP-04 "Counts". */
export interface EventSummary {
  invited: number;
  delivered: number;
  read: number;
  accepted: number;
  declined: number;
  noReply: number;
  extras: { cap: number; used: number; available: number };
  admitted: number;
  updatedAt: Date;
}
