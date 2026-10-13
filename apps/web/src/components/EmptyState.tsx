import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700">
      <p>{title}</p>
      {children && <div className="mt-3 text-sm">{children}</div>}
    </div>
  );
}
