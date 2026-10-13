import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { btnPrimary } from './ui';

export interface ToastInput {
  message: string;
  kind?: 'info' | 'error';
  action?: { label: string; onClick: () => void };
}
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);
  const show = useCallback(
    (t: ToastInput) => {
      const id = nextId++;
      setItems((list) => [...list, { ...t, id }]);
      setTimeout(
        () => {
          dismiss(id);
        },
        t.action ? 12_000 : 5_000,
      );
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              t.kind === 'error' ? 'bg-red-700' : 'bg-gray-800'
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="סגור"
              onClick={() => {
                dismiss(t.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
