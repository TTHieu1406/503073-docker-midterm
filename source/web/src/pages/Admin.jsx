import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/cart.js';

const CATEGORIES = ['Keyboards', 'Audio', 'Displays', 'Accessories'];
const EMPTY = { name: '', description: '', category: 'Keyboards', price: '', stock: '' };

export default function Admin() {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [catalog, recent] = await Promise.all([api('/products'), api('/orders?all=1')]);
    setProducts(catalog.products);
    setOrders(recent.orders);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  function edit(product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description,
      category: product.category,
      price: (product.priceCents / 100).toFixed(2),
      stock: String(product.stock),
    });
    setError('');
    setNotice('');
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const body = {
      name: form.name,
      description: form.description,
      category: form.category,
      priceCents: Math.round(Number(form.price) * 100),
      stock: Number(form.stock),
    };
    try {
      if (editingId) await api(`/products/${editingId}`, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      setNotice(editingId ? 'Product updated.' : 'Product added.');
      reset();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(product) {
    if (!window.confirm(`Delete "${product.name}"?`)) return;
    setError('');
    setNotice('');
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      setNotice('Product deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h1>Manage store</h1>
      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-ok">{notice}</p>}

      <div className="admin-layout">
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td className="muted">{product.category}</td>
                  <td className="num">{formatPrice(product.priceCents)}</td>
                  <td className="num">{product.stock}</td>
                  <td className="row-actions">
                    <button type="button" className="link" onClick={() => edit(product)}>Edit</button>
                    <button type="button" className="link link-danger" onClick={() => remove(product)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="card product-form" onSubmit={submit}>
          <h2>{editingId ? 'Edit product' : 'Add product'}</h2>
          <label>
            Name
            <input required minLength={2} value={form.name} onChange={change('name')} />
          </label>
          <label>
            Description
            <textarea required minLength={2} rows={3} value={form.description} onChange={change('description')} />
          </label>
          <label>
            Category
            <select value={form.category} onChange={change('category')}>
              {CATEGORIES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <div className="form-row">
            <label>
              Price (USD)
              <input type="number" required min="0" step="0.01" value={form.price} onChange={change('price')} />
            </label>
            <label>
              Stock
              <input type="number" required min="0" step="1" value={form.stock} onChange={change('stock')} />
            </label>
          </div>
          <button type="submit" className="btn btn-primary btn-block">{editingId ? 'Save changes' : 'Add product'}</button>
          {editingId && <button type="button" className="link" onClick={reset}>Cancel</button>}
        </form>
      </div>

      <h2 className="section-title">Recent orders</h2>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Worker</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 8).map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{order.customer}</td>
                <td><span className={`pill status-${order.status}`}>{order.status}</span></td>
                <td><code>{order.processedBy ?? '—'}</code></td>
                <td className="num">{formatPrice(order.totalCents)}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan="5" className="muted">No orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
