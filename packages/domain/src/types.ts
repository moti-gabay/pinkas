import type { Agorot } from './money.js';
import type { IsoDate } from './dates.js';

export type TxnStatus = 'pending' | 'completed';
export type TxnOrigin = 'scraper' | 'import' | 'manual';

/**
 * A transaction as every source produces it, before persistence. Raw inputs needed by the
 * dedupe hash (`descriptionRaw`, `externalIdentifier`) are kept verbatim.
 */
export interface NormalizedTxn {
  accountId: string;
  origin: TxnOrigin;
  externalIdentifier: string | undefined;
  txnDate: IsoDate;
  processedDate: IsoDate | undefined;
  chargedAmountAgorot: Agorot;
  originalAmountMinor: Agorot | undefined;
  originalCurrency: string | undefined;
  status: TxnStatus;
  descriptionRaw: string;
  memo: string | undefined;
  installmentNumber: number | undefined;
  installmentTotal: number | undefined;
}

export type HashKind = 'identifier' | 'fields';

export interface HashedTxn extends NormalizedTxn {
  dedupeHash: string;
  hashKind: HashKind;
  hashVersion: number;
  merchantNormalized: string;
  installmentGroupKey: string | undefined;
}

/** Minimal view of a stored row that domain functions need. */
export interface StoredTxn {
  id: string;
  accountId: string;
  dedupeHash: string;
  hashKind: HashKind;
  externalIdentifier: string | undefined;
  txnDate: IsoDate;
  processedDate: IsoDate | undefined;
  chargedAmountAgorot: Agorot;
  status: TxnStatus;
  descriptionRaw: string;
  merchantNormalized: string;
  categoryId: string | undefined;
  categorySource: 'rule' | 'ai' | 'manual' | 'refund_link' | 'default' | undefined;
  isFixed: boolean | undefined;
  excludeReason: 'card_settlement' | 'internal_transfer' | 'duplicate' | 'user' | undefined;
  installmentNumber: number | undefined;
  installmentTotal: number | undefined;
}
