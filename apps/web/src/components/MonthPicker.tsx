import { formatMonth } from '@pinkas/shared';
import { addMonths } from '../lib/month';
import { btn } from './ui';

export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={btn}
        aria-label="חודש קודם"
        onClick={() => {
          onChange(addMonths(month, -1));
        }}
      >
        ›
      </button>
      <span className="min-w-28 text-center font-semibold">{formatMonth(month)}</span>
      <button
        type="button"
        className={btn}
        aria-label="חודש הבא"
        onClick={() => {
          onChange(addMonths(month, 1));
        }}
      >
        ‹
      </button>
    </div>
  );
}
