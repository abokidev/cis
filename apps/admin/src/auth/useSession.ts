import { useCallback, useState } from 'react';
import type { AuthUser } from '../api/types';

const STORAGE_KEY = 'cis.admin.session';

export interface Session {
  token: string;
  user: AuthUser;
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function useSession(): {
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
} {
  const [session, setSession] = useState<Session | null>(() => read());

  const signIn = useCallback((next: Session) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: session simply won't persist across reloads.
    }
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setSession(null);
  }, []);

  return { session, signIn, signOut };
}
