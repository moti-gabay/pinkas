/** Response of GET /reconciliation. Amounts are integer agorot; dates are YYYY-MM-DD. */
export interface SettlementDto {
  id: string;
  bankTxnId: string;
  bankTxnDate: string;
  bankAmountAgorot: number;
  bankDescription: string;
  cardAccountId: string;
  cardAccountLabel: string;
  cycleDate: string;
  expectedTotalAgorot: number;
  diffAgorot: number;
  status: 'matched' | 'partial';
}

export interface ReconciliationLeg {
  txnId: string;
  accountLabel: string;
  txnDate: string;
  amountAgorot: number;
  description: string;
}

export interface TransferLinkDto {
  linkId: string;
  /** 0..1 */
  confidence: number;
  createdBy: 'system' | 'user';
  from: ReconciliationLeg;
  to: ReconciliationLeg;
}

export interface ReconciliationDto {
  settlements: SettlementDto[];
  transfers: TransferLinkDto[];
  stalePending: ReconciliationLeg[];
}
