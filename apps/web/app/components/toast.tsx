'use client';
import { createContext, useActionState, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string }
interface Toasts { success: (message: string) => void; error: (message: string) => void }

const NOOP: Toasts = { success: () => undefined, error: () => undefined };
const ToastContext = createContext<Toasts>(NOOP);

const LIFETIME_MS: Record<ToastKind, number> = { success: 4000, error: 7000 };

/** Mounted once in the root layout, so a toast survives the client navigation a redirecting action causes. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = (next.current += 1);
    setItems((all) => [...all.slice(-3), { id, kind, message }]);
    window.setTimeout(() => dismiss(id), LIFETIME_MS[kind]);
  }, [dismiss]);

  const api = useMemo<Toasts>(() => ({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">{t.kind === 'success' ? '✓' : '!'}</span>
            <span className="toast-text">{t.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  return useContext(ToastContext);
}

/**
 * `useActionState` that also reports the outcome in a toast: `success` when the
 * action finishes without an error, the error text when it does not. Pass `null`
 * for an action whose own screen already says what happened (a preview, a form
 * with a confirmation panel).
 *
 * Keyed on the pending flag rather than on the returned state: a successful
 * save returns the same empty state every time, so a second save would not
 * look like a change.
 */
export function useActionStateWithToast<S extends { error?: string }, P>(
  action: (state: Awaited<S>, payload: P) => S | Promise<S>,
  initial: Awaited<S>,
  success: string | null,
): [Awaited<S>, (payload: P) => void, boolean] {
  const [state, run, pending] = useActionState(action, initial);
  const toast = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state.error) toast.error(state.error);
      else if (success) toast.success(success);
    }
    wasPending.current = pending;
  }, [pending, state, success, toast]);

  /**
   * An action that redirects on success (creating a record) unmounts its form
   * while still pending, so the effect above never sees it finish. The provider
   * outlives the navigation, so the form says its piece as it goes.
   */
  const latest = useRef({ success, toast });
  latest.current = { success, toast };
  useEffect(() => () => {
    if (wasPending.current && latest.current.success) latest.current.toast.success(latest.current.success);
  }, []);

  return [state, run, pending];
}
