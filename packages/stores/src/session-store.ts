import { makeAutoObservable } from 'mobx';

export interface SessionUser {
  id: string;
  username: string;
}

export class SessionStore {
  token: string | null = null;
  user: SessionUser | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get isAuthenticated(): boolean {
    return this.token !== null;
  }

  signIn(token: string, user: SessionUser): void {
    this.token = token;
    this.user = user;
  }

  signOut(): void {
    this.token = null;
    this.user = null;
  }
}
