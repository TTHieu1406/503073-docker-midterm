import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const user =
        mode === 'login'
          ? await login(form.email, form.password)
          : await register(form.name, form.email, form.password);
      navigate(location.state?.from ?? (user.role === 'admin' ? '/ops' : '/'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth card">
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <label>
            Full name
            <input required minLength={2} value={form.name} onChange={change('name')} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" required value={form.email} onChange={change('email')} autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : 1}
            value={form.password}
            onChange={change('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="alert alert-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        className="link"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}
      >
        {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
      </button>
    </section>
  );
}
