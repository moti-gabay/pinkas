import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';
import { UNAUTHORIZED_EVENT } from '../lib/api';
import { keys, useAuthStatus, useLogin, useSetup } from '../lib/queries';
import { ErrorNote } from './ErrorNote';
import { Spinner } from './Spinner';
import { btn, btnPrimary, card, input, label } from './ui';

export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useAuthStatus();

  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(keys.auth, { authenticated: false, setupRequired: false });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [qc]);

  if (status.isPending) return <Spinner className="mt-20" />;
  if (status.isError) {
    return (
      <div className="mx-auto mt-20 max-w-sm text-center">
        <ErrorNote error={status.error} />
        <button type="button" className={`${btn} mt-3`} onClick={() => void status.refetch()}>
          נסה שוב
        </button>
      </div>
    );
  }
  if (status.data.setupRequired) return <PasswordScreen mode="setup" />;
  if (!status.data.authenticated) return <PasswordScreen mode="login" />;
  return children;
}

function PasswordScreen({ mode }: { mode: 'setup' | 'login' }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const login = useLogin();
  const setup = useSetup();
  const mutation = mode === 'setup' ? setup : login;
  const mismatch = mode === 'setup' && confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 10;

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (tooShort || mismatch || password.length === 0) return;
    mutation.mutate(password);
  };

  return (
    <div className="mx-auto mt-20 max-w-sm">
      <form onSubmit={submit} className={`${card} flex flex-col gap-3`}>
        <h1 className="text-xl font-bold">{mode === 'setup' ? 'הגדרת סיסמה' : 'כניסה'}</h1>
        {mode === 'setup' && (
          <p className="text-sm text-gray-500">
            בחר סיסמה בת 10 תווים לפחות. זו תהיה הסיסמה היחידה לאפליקציה.
          </p>
        )}
        <label className={label}>
          סיסמה
          <input
            className={input}
            type="password"
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            autoFocus
          />
        </label>
        {mode === 'setup' && (
          <label className={label}>
            אימות סיסמה
            <input
              className={input}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
            />
          </label>
        )}
        {tooShort && <p className="text-sm text-red-700">לפחות 10 תווים</p>}
        {mismatch && <p className="text-sm text-red-700">הסיסמאות אינן תואמות</p>}
        <ErrorNote error={mutation.error} />
        <button type="submit" className={btnPrimary} disabled={mutation.isPending}>
          {mode === 'setup' ? 'שמור והיכנס' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
