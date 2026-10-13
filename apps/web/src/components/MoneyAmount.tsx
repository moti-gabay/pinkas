import { formatAgorot } from '@pinkas/shared';

export function MoneyAmount({
  agorot,
  whole = false,
  className = '',
}: {
  agorot: number;
  whole?: boolean;
  className?: string;
}) {
  const color =
    agorot < 0 ? 'text-(--color-expense)' : agorot > 0 ? 'text-(--color-income)' : 'text-gray-500';
  return <span className={`num ${color} ${className}`}>{formatAgorot(agorot, { whole })}</span>;
}
