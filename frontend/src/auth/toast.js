/* A tiny toast store (success / error / info), rendered by <Toaster/>. */
import { useSyncExternalStore } from 'react';

let items = [], seq = 0;
const subs = new Set();
const emit = () => subs.forEach(f => f());
export const subscribeToasts = f => { subs.add(f); return () => subs.delete(f); };
export const getToasts = () => items;
export const useToasts = () => useSyncExternalStore(subscribeToasts, getToasts);

export function toast(message, kind = 'info', ms = 4200) {
  const id = ++seq;
  items = [...items, { id, message, kind }];
  emit();
  setTimeout(() => dismissToast(id), ms);
}
export const dismissToast = id => { items = items.filter(t => t.id !== id); emit(); };
export const toastOk = m => toast(m, 'ok');
export const toastErr = m => toast(m, 'err', 6000);
