import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/cart.js';
import { useEvents } from '../lib/useEvents.js';

const STEPS = [
  ['pending', 'Queued'],
  ['processing', 'Processing'],
  ['paid', 'Paid'],
  ['packed', 'Packed'],
  ['shipped', 'Shipped'],
];

function Timeline({ status }) {
  const reached = STEPS.findIndex(([key]) => key === status);
  return (
    <ol className="timeline">
      {STEPS.map(([key, label], index) => (
        <li key={key} className={index < reached ? 'done' : index === reached ? 'current' : ''}>
          <span className="dot" />
          {label}
        </li>
      ))}
    </ol>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/orders');
      setOrders(data.orders);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Whichever worker handles the order, its progress arrives here through
  // Redis pub/sub, then the API replica this page is connected to.
  useEvents({ 'order.updated': load });

  if (loading) return <p className="muted">Loading orders…</p>;

  return (
    <section>
      <h1>My orders</h1>
      {error && <p className="alert alert-error">{error}</p>}
      {!error && orders.length === 0 && (
        <div className="empty">
          <p className="muted">You have not ordered anything yet.</p>
          <Link to="/" className="btn btn-primary">Browse products</Link>
        </div>
      )}
      <div className="order-list">
        {orders.map((order) => (
          <article className="card order" key={order.id}>
            <header className="order-header">
              <div>
                <h3>Order #{order.id}</h3>
                <span className="muted small">{new Date(order.createdAt).toLocaleString('en-GB')}</span>
              </div>
              <strong className="price">{formatPrice(order.totalCents)}</strong>
            </header>
            {order.status === 'failed' ? (
              <p className="alert alert-error">{order.failureReason ?? 'This order failed.'} Your items went back into stock.</p>
            ) : (
              <Timeline status={order.status} />
            )}
            <ul className="order-items">
              {order.items.map((item) => (
                <li key={item.productId}>
                  <span>{item.quantity} × {item.name}</span>
                  <span>{formatPrice(item.unitPriceCents * item.quantity)}</span>
                </li>
              ))}
            </ul>
            {order.processedBy && (
              <p className="muted small">Last handled by worker <code>{order.processedBy}</code></p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
