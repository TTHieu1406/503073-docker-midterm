import { useCallback, useEffect, useState } from 'react';
import ProductArt from '../components/ProductArt.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { formatPrice } from '../lib/cart.js';
import { useEvents } from '../lib/useEvents.js';

const CATEGORIES = ['All', 'Keyboards', 'Audio', 'Displays', 'Accessories'];

export default function Shop() {
  const { user } = useAuth();
  const { add, lines } = useCart();
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [cacheStatus, setCacheStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort });
    if (category !== 'All') params.set('category', category);
    if (search.trim()) params.set('q', search.trim());
    const started = performance.now();
    try {
      const response = await fetch(`/api/products?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProducts(data.products);
      setCacheStatus({ result: response.headers.get('X-Cache'), ms: Math.round(performance.now() - started) });
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [category, search, sort]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  // Stock changes appear as soon as anyone buys something, without a page reload.
  useEvents({ 'catalog.updated': load }, Boolean(user));

  const inCart = (id) => lines.find((line) => line.id === id)?.quantity ?? 0;

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Gear for people who ship</p>
          <h1>Everything on your desk, delivered in containers.</h1>
          <p className="hero-text">
            This store runs as a set of containers. Sign in as an administrator and open the Ops Center to scale it, break
            it, and watch it recover.
          </p>
        </div>
      </section>

      <section className="toolbar">
        <div className="chips" role="tablist" aria-label="Category">
          {CATEGORIES.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip ${category === name ? 'active' : ''}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <input
            type="search"
            placeholder="Search products"
            aria-label="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select aria-label="Sort by" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">Name</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </div>
      </section>

      {cacheStatus && (
        <p className="cache-note">
          <span className={`pill ${cacheStatus.result === 'HIT' ? 'pill-ok' : 'pill-warn'}`}>Redis cache {cacheStatus.result}</span>
          answered in {cacheStatus.ms} ms
        </p>
      )}

      {error && <p className="alert alert-error">{error}</p>}
      {loading && <p className="muted">Loading products…</p>}
      {!loading && !error && products.length === 0 && <p className="muted">No products match your search.</p>}

      <section className="grid">
        {products.map((product) => {
          const available = product.stock - inCart(product.id);
          return (
            <article className="card product-card" key={product.id}>
              <ProductArt category={product.category} />
              <div className="product-body">
                <p className="product-category">{product.category}</p>
                <h3>{product.name}</h3>
                <p className="product-description">{product.description}</p>
                <div className="product-footer">
                  <div>
                    <strong className="price">{formatPrice(product.priceCents)}</strong>
                    <span className={`stock ${product.stock < 15 ? 'stock-low' : ''}`}>
                      {product.stock > 0 ? `${product.stock} in stock` : 'Sold out'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={available <= 0}
                    onClick={() => add(product)}
                  >
                    Add to cart
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
