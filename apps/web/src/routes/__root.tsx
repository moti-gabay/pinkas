import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';

const nav = [
  { to: '/', label: 'סקירה' },
  { to: '/transactions', label: 'תנועות' },
  { to: '/import', label: 'ייבוא' },
  { to: '/accounts', label: 'חשבונות' },
  { to: '/settings', label: 'הגדרות' },
] as const;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="text-xl font-bold">פנקס</span>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="hover:underline"
                activeProps={{ className: 'font-semibold underline' }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  ),
});
