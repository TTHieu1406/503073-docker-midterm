import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ProductArt from '../components/ProductArt.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/cart.js';

export default function Cart() {
  const { lines, total, update, clear } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function checkout() {
    if (!user) {
      navigate('/login', { state: { from: '/cart' } });
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const items = lines.map((line) => ({ productId: line.id, quantity: line.quantity }));
      await api('/orders', { method: 'POST', body: { items } });
      clear();
      navigate('/orders');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return (
      <section className="empty">
        <h1>Your cart is empty</h1>
        <p className="muted">Add something from the shop to get started.</p>
        <Link to="/" className="btn btn-primary">Browse products</Link>
      </section>
    );
  }

  return (
    <section className="cart-layout">
      <div>
        <h1>Your cart</h1>
        <div className="card cart-lines">
          {lines.map((line) => (
            <div className="cart-line" key={line.id}>
              <ProductArt category={line.category} small />
              <div className="cart-line-name">
                <strong>{line.name}</strong>
                <span className="muted">{formatPrice(line.priceCents)} each</span>
              </div>
              <div className="stepper">
                <button type="button" aria-label={`Remove one ${line.name}`} onClick={() => update(line.id, line.quantity - 1)}>−</button>
                <span>{line.quantity}</span>
                <button type="button" aria-label={`Add one ${line.name}`} onClick={() => update(line.id, line.quantity + 1)}>+</button>
              </div>
              <strong className="cart-line-total">{formatPrice(line.priceCents * line.quantity)}</strong>
            </div>
          ))}
        </div>
      </div>

      <aside className="card summary">
        <h2>Summary</h2>
        <div className="summary-row"><span>Subtotal</span><span>{formatPrice(total)}</span></div>
        <div className="summary-row"><span>Shipping</span><span>Free</span></div>
        <div className="summary-row summary-total"><span>Total</span><span>{formatPrice(total)}</span></div>
        {error && <p className="alert alert-error">{error}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={submitting} onClick={checkout}>
          {submitting ? 'Placing order…' : user ? 'Place order' : 'Sign in to order'}
        </button>
        <p className="muted small">Your order goes into a queue, and a worker container handles it in the background.</p>
      </aside>
    </section>
  );
}
