import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';
import styles from './HealthBadge.module.css';

export function HealthBadge() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  let state: 'checking' | 'online' | 'offline' = 'checking';
  let text = 'Checking API…';
  if (!isPending && (isError || !data)) {
    state = 'offline';
    text = 'API unavailable';
  } else if (data) {
    state = 'online';
    text = `API online${data.version ? ` · v${data.version}` : ''}`;
  }

  // Text always states the status; colour is only a secondary cue.
  return (
    <span role="status" className={`${styles.badge} ${styles[state]}`}>
      <span aria-hidden="true" className={styles.dot} />
      {text}
    </span>
  );
}
