import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { onServedBy } from '../lib/api.js';

export default function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const [served, setServed] = useState(null);

  useEffect(() => onServedBy(setServed), []);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            DockMart
          </Link>
          <nav className="nav">
            <NavLink to="/" end>Shop</NavLink>
            {user && <NavLink to="/orders">My orders</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin">Manage store</NavLink>}
            {user?.role === 'admin' && <NavLink to="/ops">Ops Center</NavLink>}
          </nav>
          <div className="topbar-actions">
            <Link to="/cart" className="cart-link">
              Cart{count > 0 && <span className="badge">{count}</span>}
            </Link>
            {user ? (
              <>
                <span className="user-name">{user.name}</span>
                <button type="button" className="btn btn-ghost" onClick={handleLogout}>Sign out</button>
              </>
            ) : (
              <Link to="/login" className="btn btn-primary">Sign in</Link>
            )}
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="footer">
        <span>DockMart, a Docker and Kubernetes demonstration for course 503073.</span>
        {served && (
          <span className="served-by" title="The replica that answered the latest API request">
            Served by <code>{served.servedBy}</code> · v{served.version}
          </span>
        )}
      </footer>
    </div>
  );
}
