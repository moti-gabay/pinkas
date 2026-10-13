import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/import')({
  component: () => <h1 className="text-2xl font-bold">ייבוא</h1>,
});
