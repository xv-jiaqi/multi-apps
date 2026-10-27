import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useStores } from '../stores/root-store';
import { bindSessionRefresh } from '../lib/session-refresh';
import { trpc } from '../lib/trpc';

export const AuthBootstrap = observer(function AuthBootstrap() {
  const { session } = useStores();
  const token = session.token;

  const me = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const refetchMe = me.refetch;

  useEffect(() => bindSessionRefresh(() => void refetchMe()), [refetchMe]);

  useEffect(() => {
    if (token && me.data) {
      session.signIn(token, me.data);
    }
  }, [me.data, session, token]);

  return null;
});
