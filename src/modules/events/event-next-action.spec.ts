import {
  EventApprovalStatus as Approval,
  EventCampaignStatus as Campaign,
  EventListStatus as List,
  EventPaymentStatus as Payment,
  EventStatus as Status,
} from './entities/event.entity';
import { nextActionOf } from './event-next-action';

const paid = {
  status: Status.ACTIVE,
  paymentStatus: Payment.PAID,
  listStatus: List.READY,
  approvalStatus: Approval.APPROVED,
  campaignStatus: Campaign.NOT_SCHEDULED,
};

describe('nextActionOf', () => {
  it.each([
    [{ status: Status.CANCELLED, paymentStatus: Payment.UNPAID }, 'CANCELLED'],
    [{ status: Status.CLOSED, campaignStatus: Campaign.SENT }, 'CLOSED'],
    [{ paymentStatus: Payment.UNPAID }, 'COMPLETE_PAYMENT'],
    [{ paymentStatus: Payment.PENDING }, 'COMPLETE_PAYMENT'],
    [{ listStatus: List.AWAITING_LIST }, 'SEND_LIST'],
    [{ listStatus: List.IN_PROGRESS }, 'LIST_IN_PROGRESS'],
    [{ approvalStatus: Approval.AWAITING_OWNER }, 'APPROVE_INVITATION'],
    [{}, 'AWAITING_SCHEDULE'],
    [{ campaignStatus: Campaign.SCHEDULED }, 'SCHEDULED'],
    [{ campaignStatus: Campaign.SENDING }, 'SENDING'],
    [{ campaignStatus: Campaign.PAUSED }, 'PAUSED'],
    [{ campaignStatus: Campaign.SENT }, 'RESULTS'],
  ])('%j → %s', (state, expected) => {
    expect(nextActionOf({ ...paid, ...state })).toBe(expected);
  });
});
