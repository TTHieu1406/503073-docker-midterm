import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/cart.js';

const POLL_MS = 1000;
const BURST_SIZE = 300;
const BURST_CONCURRENCY = 12;

const shortId = (id) => id.slice(0, 12);

function formatUptime(startedAt, now) {
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const formatMemory = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

function ReplicaCard({ instance, now, onChaos }) {
  const state = !instance.healthy ? 'failing' : !instance.ready ? 'draining' : 'healthy';
  return (
    <article className={`replica replica-${state}`}>
      <header>
        <strong title={instance.id}>{instance.name}</strong>
        <span className={`pill pill-${state}`}>{state}</span>
      </header>
      <dl>
        <div><dt>Version</dt><dd>v{instance.version}</dd></div>
        <div><dt>Uptime</dt><dd>{formatUptime(instance.startedAt, now)}</dd></div>
        <div><dt>CPU</dt><dd>{instance.cpuPercent.toFixed(1)}%</dd></div>
        <div><dt>Memory</dt><dd>{formatMemory(instance.rssBytes)}</dd></div>
        <div><dt>Restarts</dt><dd>{instance.restarts}</dd></div>
        {instance.role === 'api' ? (
          <div><dt>Requests</dt><dd>{instance.requests}</dd></div>
        ) : (
          <div><dt>Orders</dt><dd>{instance.jobs}{instance.active > 0 ? ` (+${instance.active})` : ''}</dd></div>
        )}
      </dl>
      <footer>
        <button type="button" className="btn btn-danger" onClick={() => onChaos('crash', instance)}>Kill</button>
        {instance.healthy ? (
          <button type="button" className="btn btn-outline" onClick={() => onChaos('unhealthy', instance)}>Fail probe</button>
        ) : (
          <button type="button" className="btn btn-outline" onClick={() => onChaos('healthy', instance)}>Heal</button>
        )}
      </footer>
    </article>
  );
}

function Burst() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  async function fire() {
    setRunning(true);
    const counts = {};
    let completed = 0;
    let failed = 0;
    const started = performance.now();

    async function runner() {
      while (completed + failed < BURST_SIZE) {
        completed += 1;
        try {
          const response = await fetch('/api/whoami');
          if (!response.ok) throw new Error(String(response.status));
          const { instance } = await response.json();
          counts[instance] = (counts[instance] ?? 0) + 1;
        } catch {
          completed -= 1;
          failed += 1;
        }
      }
    }

    await Promise.all(Array.from({ length: BURST_CONCURRENCY }, runner));
    setResult({ counts, failed, ms: Math.round(performance.now() - started) });
    setRunning(false);
  }

  const entries = Object.entries(result?.counts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const highest = Math.max(1, ...entries.map(([, count]) => count));

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Load balancing</h2>
          <p>Send {BURST_SIZE} requests through the gateway and see which replica answers each one.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={running} onClick={fire}>
          {running ? 'Sending…' : `Send ${BURST_SIZE} requests`}
        </button>
      </header>
      {entries.length > 0 && (
        <div className="bars">
          {entries.map(([instance, count]) => (
            <div className="bar-row" key={instance}>
              <code>{shortId(instance)}</code>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(count / highest) * 100}%` }} /></div>
              <span>{count}</span>
            </div>
          ))}
          <p className="panel-note">
            {result.ms} ms in total · {Math.round((BURST_SIZE / result.ms) * 1000)} requests per second · {result.failed} failed
          </p>
        </div>
      )}
    </section>
  );
}

export default function Ops() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setOverview(await api('/ops/overview'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function chaos(action, instance) {
    await api('/ops/chaos', { method: 'POST', body: { action, target: instance.id } }).catch((err) => setError(err.message));
    refresh();
  }

  if (!overview) return <p className="muted">{error || 'Connecting to the cluster…'}</p>;

  const byName = (a, b) => a.name.localeCompare(b.name);
  const apis = overview.instances.filter((instance) => instance.role === 'api').sort(byName);
  const workers = overview.instances.filter((instance) => instance.role === 'worker').sort(byName);
  const lookups = overview.cache.hits + overview.cache.misses;
  const hitRatio = lookups ? Math.round((overview.cache.hits / lookups) * 100) : 0;

  return (
    <div className="ops">
      <header className="ops-header">
        <div>
          <p className="eyebrow">Ops Center</p>
          <h1>Live view of the running replicas</h1>
          <p className="muted">
            Every replica reports to Redis every two seconds. A replica that stops reporting leaves this page within six
            seconds. This page was served by <code>{shortId(overview.servedBy)}</code>.
          </p>
        </div>
      </header>

      {error && <p className="alert alert-error">The API did not answer: {error}. Retrying…</p>}

      <section className="stats">
        <div className="stat"><span>API replicas</span><strong>{apis.length}</strong></div>
        <div className="stat"><span>Worker replicas</span><strong>{workers.length}</strong></div>
        <div className="stat"><span>Orders</span><strong>{overview.totals.orders}</strong></div>
        <div className="stat"><span>Revenue</span><strong>{formatPrice(overview.totals.revenueCents)}</strong></div>
        <div className="stat"><span>Queue</span><strong>{overview.queue.waiting + overview.queue.active}</strong></div>
        <div className="stat"><span>Cache hit ratio</span><strong>{hitRatio}%</strong></div>
      </section>

      <section className="panel">
        <header className="panel-header"><h2>API replicas</h2></header>
        <div className="replicas">
          {apis.map((instance) => <ReplicaCard key={instance.id} instance={instance} now={now} onChaos={chaos} />)}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header"><h2>Worker replicas</h2></header>
        <div className="replicas">
          {workers.map((instance) => <ReplicaCard key={instance.id} instance={instance} now={now} onChaos={chaos} />)}
          {workers.length === 0 && <p className="muted">No workers are running. Orders wait in the queue until one starts.</p>}
        </div>
      </section>

      <div className="ops-columns">
        <Burst />
        <section className="panel">
          <header className="panel-header"><h2>Cluster events</h2></header>
          <ul className="event-log">
            {overview.log.map((entry) => (
              <li key={`${entry.at}-${entry.message}`} className={`log-${entry.level}`}>
                <time>{new Date(entry.at).toLocaleTimeString('en-GB')}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
