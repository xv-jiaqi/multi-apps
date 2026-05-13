import { makeAutoObservable } from 'mobx';

export interface SessionUser {
  id: string;
  username: string;
  role?: string;
}

/**
 * Pluggable storage abstraction so the same store works in browser
 * (window.localStorage), Tauri (window.localStorage shim) and miniapp
 * (Taro.getStorageSync). Pass `null` when there is no persistent storage
 * available — the store will run in memory only.
 */
export interface SessionStorageDriver {
  get(): { token: string; user: SessionUser } | null;
  set(value: { token: string; user: SessionUser }): void;
  clear(): void;
}

export class SessionStore {
  token: string | null = null;
  user: SessionUser | null = null;

  constructor(private readonly driver?: SessionStorageDriver | null) {
    makeAutoObservable<this, 'driver'>(this, { driver: false });
    if (driver) {
      const cached = driver.get();
      if (cached) {
        this.token = cached.token;
        this.user = cached.user;
      }
    }
  }

  get isAuthenticated(): boolean {
    return this.token !== null && this.user !== null;
  }

  get isAdmin(): boolean {
    return this.user?.role === 'admin';
  }

  signIn(token: string, user: SessionUser): void {
    this.token = token;
    this.user = user;
    this.driver?.set({ token, user });
  }

  signOut(): void {
    this.token = null;
    this.user = null;
    this.driver?.clear();
  }
}
