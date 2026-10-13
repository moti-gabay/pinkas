import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/accounts')({
  component: () => <h1 className="text-2xl font-bold">חשבונות</h1>,
});
