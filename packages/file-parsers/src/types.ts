import type { Agorot, IsoDate } from '@pinkas/domain';

export type FileFormat = 'csv' | 'xlsx' | 'pdf';
export type Cell = string | number | null;

/** One CSV file or one XLSX worksheet. Row indices are positional and stable across parsing. */
export interface RawTable {
  name: string;
  rows: Cell[][];
}

export interface LoadedFile {
  format: FileFormat;
  encoding?: string;
  tables: RawTable[];
}

export interface ColumnMapping {
  /** 0-based row in the table that holds headers. */
  headerRowIndex: number;
  /** Header name of the transaction date column. */
  date: string;
  processedDate?: string;
  /** Single signed column (negative = outflow after amountSign is applied). */
  amount?: string;
  /** חובה column (positive numbers = outflow). */
  debit?: string;
  /** זכות column (positive numbers = inflow). */
  credit?: string;
  description: string;
  memo?: string;
  /** אסמכתא */
  identifier?: string;
  originalAmount?: string;
  originalCurrency?: string;
  /** Running balance column, if any. */
  balance?: string;
  /** 'invert' when the export shows expenses as positive in the single amount column. */
  amountSign: 'natural' | 'invert';
  dateFormat: 'auto' | 'DMY' | 'MDY' | 'YMD';
}

export interface ParsedRow {
  /** Index in RawTable.rows. */
  rowIndex: number;
  txnDate: IsoDate;
  processedDate: IsoDate | undefined;
  /** Negative = outflow, positive = inflow. */
  chargedAmountAgorot: Agorot;
  originalAmountMinor: Agorot | undefined;
  originalCurrency: string | undefined;
  descriptionRaw: string;
  memo: string | undefined;
  externalIdentifier: string | undefined;
  status: 'pending' | 'completed';
  installmentNumber: number | undefined;
  installmentTotal: number | undefined;
  balanceAgorot: Agorot | undefined;
  /** Header → cell text, for the preview. */
  raw: Record<string, string>;
}

/** English, internal; the API layer owns user-facing text. */
export interface ParseError {
  rowIndex: number;
  message: string;
}

export interface ParseResult {
  headers: string[];
  rows: ParsedRow[];
  errors: ParseError[];
  skippedRows: number[];
  /** From a summary/total row if present (e.g. 'סה"כ'). */
  statementTotalAgorot: Agorot | undefined;
  /** Last balance cell if a balance column exists. */
  closingBalanceAgorot: Agorot | undefined;
}

export interface SourceAdapter {
  id: string;
  nameHe: string;
  formats: FileFormat[];
  /** 0..1 confidence this file is from this source. */
  detect(file: LoadedFile): number;
  defaultMapping(table: RawTable): ColumnMapping | undefined;
}
