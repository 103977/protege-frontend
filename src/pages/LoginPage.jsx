import { useState } from 'react';
import './LoginPage.css';

const PATENT_SAMPLES = [
  'US 10,234,567 B2',
  'US 9,887,221 A1',
  'EP 3 456 789 B1',
  'WO 2021/045123 A1',
  'US 11,002,344 B2',
  'JP 2020-123456 A',
  'US 8,765,432 B1',
  'EP 2 998 877 A1',
];

// Deterministic-ish scatter for the background field, generated once per mount.
function makePatentField(count = 18) {
  return Array.from({ length: count }, (_, i) => ({
    text: PATENT_SAMPLES[i % PATENT_SAMPLES.length],
    left: Math.random() * 95,
    top: Math.random() * 95,
    fontSize: 11 + Math.random() * 4,
    rotate: Math.random() * 6 - 3,
  }));
}

export function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [patentField] = useState(() => makePatentField());

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Wire this up to your real Cognito call, e.g.:
      // await login(email, password)
      await onLogin(email, password);

      setSubmitting(false);
      setSuccess(true);

      // Let the card-shrink + sweep animation play before sliding the
      // whole screen away. Timings here are tied to the CSS transitions
      // below — keep them in sync if you change those durations.
      setTimeout(() => setLeaving(true), 150);
    } catch (err) {
      setSubmitting(false);
      setError(messageForError(err));
    }
  }

  return (
    <div className={`login-screen ${leaving ? 'leaving' : ''}`}>
      <div className="patent-field" aria-hidden="true">
        {patentField.map((p, i) => (
          <span
            key={i}
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              fontSize: `${p.fontSize}px`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          >
            {p.text}
          </span>
        ))}
      </div>

      <div className={`sweep-line ${success ? 'sweeping' : ''}`} />

      <div className={`login-card ${success ? 'success' : ''}`}>
        <div className="wordmark">
          <span className="wordmark-mark" />
          <span className="wordmark-text">IP Atlas</span>
        </div>
        <p className="login-subtitle">Intellectual Property Landscape Analytics</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="email@otsuka.jp"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={error ? 'error-state' : ''}
              disabled={submitting || success}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={error ? 'error-state' : ''}
              disabled={submitting || success}
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="submit-btn" disabled={submitting || success}>
            {submitting ? (
              <>
                <span className="spinner" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="footnote">Otsuka Holdings · Internal use only</p>
      </div>
    </div>
  );
}

function messageForError(err) {
  switch (err?.code) {
    case 'NotAuthorizedException':
      return 'Incorrect email or password.';
    case 'UserNotFoundException':
      return 'No account found for that email.';
    case 'UserNotConfirmedException':
      return 'Account not confirmed yet. Contact an admin.';
    default:
      return err?.message || 'Sign-in failed. Please try again.';
  }
}