export const EVENT_STAGES = [
  'awaiting_payment',
  'awaiting_list',
  'awaiting_approval',
  'scheduled',
  'sending',
  'needs_attention',
  'done',
] as const;

export type EventStage = (typeof EVENT_STAGES)[number];

/** Stages where the next move is an admin's, shown as tasks on SCR-20. */
export const ACTION_STAGES: EventStage[] = [
  'awaiting_list',
  'awaiting_approval',
  'needs_attention',
];

/**
 * Queue stage of the row aliased `e` (information-architecture.md, "Next-step logic"; first match
 * wins). It lives in SQL because lists filter and count by it, and `needs_attention` will also
 * depend on message and payment rows (T-P2-08, T-P3-07).
 */
export const STAGE_SQL = `CASE
  WHEN e.status IN ('CANCELLED', 'CLOSED') THEN 'done'
  WHEN e.payment_status <> 'PAID' THEN 'awaiting_payment'
  WHEN e.list_status <> 'READY' THEN 'awaiting_list'
  WHEN e.approval_status = 'AWAITING_OWNER' THEN 'awaiting_approval'
  WHEN e.campaign_status = 'SCHEDULED' THEN 'scheduled'
  WHEN e.campaign_status = 'SENDING' THEN 'sending'
  WHEN e.campaign_status = 'PAUSED' THEN 'needs_attention'
  WHEN e.campaign_status = 'SENT' THEN 'done'
  ELSE 'awaiting_approval'
END`;
