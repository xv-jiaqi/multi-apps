import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

export function useAdminNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const idRef = useRef(0);
  const [notice, setNoticeState] = useState<{ id: number; text: string } | null>(null);
  const incoming = (location.state as { notice?: string } | null)?.notice;

  useEffect(() => {
    if (!incoming) return;
    idRef.current += 1;
    setNoticeState({ id: idRef.current, text: incoming });
    navigate(location.pathname, { replace: true, state: null });
  }, [incoming, location.pathname, navigate]);

  useEffect(() => {
    if (!notice) return;
    statusRef.current?.focus();
  }, [notice]);

  const setNotice = (text: string | null) => {
    if (!text) {
      setNoticeState(null);
      return;
    }
    idRef.current += 1;
    setNoticeState({ id: idRef.current, text });
  };

  return { notice: notice?.text ?? null, setNotice, statusRef };
}
