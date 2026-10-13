/**
 * Error codes shared by every app. Internal logs are English; `messageHe` is what the UI shows.
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE',
  UPLOAD_UNSUPPORTED: 'UPLOAD_UNSUPPORTED',
  IMPORT_DUPLICATE_FILE: 'IMPORT_DUPLICATE_FILE',
  IMPORT_PARSE_FAILED: 'IMPORT_PARSE_FAILED',
  IMPORT_NOT_RECONCILED: 'IMPORT_NOT_RECONCILED',
  SYNC_LOGIN_FAILED: 'SYNC_LOGIN_FAILED',
  SYNC_CHANGE_PASSWORD: 'SYNC_CHANGE_PASSWORD',
  SYNC_ACCOUNT_BLOCKED: 'SYNC_ACCOUNT_BLOCKED',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',
  SYNC_UNSUPPORTED_2FA: 'SYNC_UNSUPPORTED_2FA',
  SYNC_FAILED: 'SYNC_FAILED',
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const errorMessagesHe: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'יש להתחבר כדי להמשיך',
  FORBIDDEN: 'אין הרשאה לפעולה זו',
  NOT_FOUND: 'הפריט לא נמצא',
  VALIDATION: 'הנתונים שהוזנו אינם תקינים',
  CONFLICT: 'הפעולה מתנגשת עם נתונים קיימים',
  RATE_LIMITED: 'יותר מדי ניסיונות, נסה שוב מאוחר יותר',
  UPLOAD_TOO_LARGE: 'הקובץ גדול מדי',
  UPLOAD_UNSUPPORTED: 'סוג הקובץ אינו נתמך',
  IMPORT_DUPLICATE_FILE: 'הקובץ הזה כבר יובא',
  IMPORT_PARSE_FAILED: 'לא הצלחנו לקרוא את הקובץ',
  IMPORT_NOT_RECONCILED: 'סכום השורות אינו תואם לסיכום הדף',
  SYNC_LOGIN_FAILED:
    'ההתחברות לבנק נכשלה. בדוק את פרטי ההתחברות. המקור הושבת כדי למנוע נעילת חשבון',
  SYNC_CHANGE_PASSWORD: 'הבנק דורש החלפת סיסמה. המקור הושבת',
  SYNC_ACCOUNT_BLOCKED: 'החשבון נחסם על ידי הבנק. המקור הושבת',
  SYNC_TIMEOUT: 'פג הזמן בהתחברות לבנק',
  SYNC_UNSUPPORTED_2FA: 'אימות דו-שלבי אינו נתמך עבור מקור זה',
  SYNC_FAILED: 'הסנכרון נכשל',
  LLM_UNAVAILABLE: 'שירות ה-AI אינו זמין כרגע',
  INTERNAL: 'אירעה שגיאה פנימית',
};

export class PinkasError extends Error {
  readonly code: ErrorCode;
  readonly messageHe: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PinkasError';
    this.code = code;
    this.messageHe = errorMessagesHe[code];
    this.status = options.status ?? defaultStatus(code);
    this.details = options.details;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'UPLOAD_UNSUPPORTED':
      return 400;
    case 'CONFLICT':
    case 'IMPORT_DUPLICATE_FILE':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'UPLOAD_TOO_LARGE':
      return 413;
    case 'IMPORT_NOT_RECONCILED':
    case 'IMPORT_PARSE_FAILED':
      return 422;
    case 'LLM_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}
