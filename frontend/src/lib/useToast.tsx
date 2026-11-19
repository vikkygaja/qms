import { useCallback, useEffect, useRef, useState } from 'react';

/** Small toast: call show(message); render the returned node once in the page. */
export function useToast() {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = (
    <div className="toast" role="status" hidden={!message}>
      {message}
    </div>
  );
  return { show, node };
}
