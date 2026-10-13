import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  component: () => <h1 className="text-2xl font-bold">הגדרות</h1>,
});
