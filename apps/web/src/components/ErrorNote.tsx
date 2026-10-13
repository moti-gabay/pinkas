import { errorMessage } from '../lib/api';

export function ErrorNote({ error, className = '' }: { error: unknown; className?: string }) {
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className={`text-sm text-red-700 dark:text-red-400 ${className}`}>
      {errorMessage(error)}
    </p>
  );
}
