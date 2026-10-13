import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/transactions')({
  component: () => <h1 className="text-2xl font-bold">תנועות</h1>,
});
