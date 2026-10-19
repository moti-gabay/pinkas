import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { AuthGate } from '../components/AuthGate';
import { ToastProvider } from '../components/Toast';
import { btn } from '../components/ui';
import { useLogout } from '../lib/queries';

const nav = [
  { to: '/', label: 'סקירה' },
  { to: '/transactions', label: 'תנועות' },
  { to: '/import', label: 'ייבוא' },
  { to: '/accounts', label: 'חשבונות' },
  { to: '/sync', label: 'היסטוריית סנכרון' },
  { to: '/reconciliation', label: 'התאמות' },
  { to: '/settings', label: 'הגדרות' },
] as const;

function Layout() {
  const logout = useLogout();
  return (
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
                activeOptions={{ exact: n.to === '/' }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className={`${btn} ms-auto`}
            disabled={logout.isPending}
            onClick={() => {
              logout.mutate();
            }}
          >
            יציאה
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <ToastProvider>
      <AuthGate>
        <Layout />
      </AuthGate>
    </ToastProvider>
  ),
});
