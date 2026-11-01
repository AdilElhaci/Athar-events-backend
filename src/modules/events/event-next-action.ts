import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from './entities/event.entity';

export type NextAction =
  | 'CANCELLED'
  | 'CLOSED'
  | 'COMPLETE_PAYMENT'
  | 'SEND_LIST'
  | 'LIST_IN_PROGRESS'
  | 'APPROVE_INVITATION'
  | 'AWAITING_SCHEDULE'
  | 'SCHEDULED'
  | 'SENDING'
  | 'PAUSED'
  | 'RESULTS';

type EventState = Pick<
  Event,
  | 'status'
  | 'paymentStatus'
  | 'listStatus'
  | 'approvalStatus'
  | 'campaignStatus'
>;

/** First match wins (information-architecture.md, "Next-step logic"). */
export function nextActionOf(event: EventState): NextAction {
  if (event.status === EventStatus.CANCELLED) return 'CANCELLED';
  if (event.status === EventStatus.CLOSED) return 'CLOSED';
  if (event.paymentStatus !== EventPaymentStatus.PAID)
    return 'COMPLETE_PAYMENT';
  if (event.listStatus === EventListStatus.AWAITING_LIST) return 'SEND_LIST';
  if (event.listStatus === EventListStatus.IN_PROGRESS)
    return 'LIST_IN_PROGRESS';
  if (event.approvalStatus === EventApprovalStatus.AWAITING_OWNER)
    return 'APPROVE_INVITATION';
  switch (event.campaignStatus) {
    case EventCampaignStatus.SCHEDULED:
      return 'SCHEDULED';
    case EventCampaignStatus.SENDING:
      return 'SENDING';
    case EventCampaignStatus.PAUSED:
      return 'PAUSED';
    case EventCampaignStatus.SENT:
      return 'RESULTS';
    default:
      return 'AWAITING_SCHEDULE';
  }
}
