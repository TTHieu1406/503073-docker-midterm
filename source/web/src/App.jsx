import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Admin from './pages/Admin.jsx';
import Cart from './pages/Cart.jsx';
import Login from './pages/Login.jsx';
import Ops from './pages/Ops.jsx';
import Orders from './pages/Orders.jsx';
import Shop from './pages/Shop.jsx';

function Protected({ adminOnly = false, children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Shop />} />
        <Route path="cart" element={<Cart />} />
        <Route path="login" element={<Login />} />
        <Route path="orders" element={<Protected><Orders /></Protected>} />
        <Route path="admin" element={<Protected adminOnly><Admin /></Protected>} />
        <Route path="ops" element={<Protected adminOnly><Ops /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
