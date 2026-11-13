import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
async function api(path, body) {
  let r = await fetch(
    '/api/' + path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}
  );
  if (!r.ok)
    throw Error(
      r.status === 401
        ? 'Sign in required'
        : r.status === 429
          ? 'Please wait five minutes before trying again'
          : 'Request failed'
    );
  return r.json();
}
function App() {
  let [logged, L] = useState(false),
    [password, P] = useState(''),
    [error, E] = useState(''),
    [list, C] = useState([]),
    [selected, S] = useState(null),
    [messages, M] = useState([]),
    [query, Q] = useState(''),
    [stats, T] = useState(null),
    [busy, B] = useState(false);
  useEffect(() => {
    api('stats')
      .then(x => {
        T(x);
        L(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!logged) return;
    let alive = true;
    async function load() {
      try {
        let [c, s] = await Promise.all([
          api('conversations?q=' + encodeURIComponent(query)),
          api('stats'),
        ]);
        if (alive) {
          C(c);
          T(s);
          E('');
        }
      } catch (e) {
        if (alive) E(e.message);
      }
    }
    load();
    let t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [logged, query]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    async function load() {
      try {
        let m = await api('messages?phone=' + selected.phone);
        if (alive) M(m);
      } catch (e) {
        if (alive) E(e.message);
      }
    }
    M([]);
    load();
    let t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);
  async function login(e) {
    e.preventDefault();
    B(true);
    try {
      await api('login', { password });
      P('');
      L(true);
      E('');
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  async function select(c) {
    S(c);
    try {
      await api('seen', { phone: c.phone });
      C(list.map(x => (x.phone === c.phone ? { ...x, unread: 0 } : x)));
    } catch (e) {
      E(e.message);
    }
  }
  if (!logged)
    return (
      <main className="login">
        <div className="brand">◉ Quiet Inbox</div>
        <form onSubmit={login}>
          <span className="eyebrow">PRIVATE CONVERSATIONS</span>
          <h1>
            A clearer view.
            <br />
            Nothing to send.
          </h1>
          <p>Secure, read-only access to your WhatsApp conversation history.</p>
          <label>
            Administrator password
            <input
              type="password"
              value={password}
              onChange={e => P(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Signing in…' : 'Open dashboard →'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
        <small>
          No WhatsApp sending permissions. Your conversations stay yours.
        </small>
      </main>
    );
  return (
    <main className="shell">
      <header className="top">
        <strong>◉ Quiet Inbox</strong>
        <span className="tag">READ ONLY</span>
        <div className="grow" />
        <span className="sync">
          {stats?.sync.error
            ? '◌ Reconnecting'
            : stats?.sync.last_sync
              ? '● Synced'
              : '○ Sync not configured'}
        </span>
        <button
          className="ghost"
          onClick={async () => {
            await api('logout', {});
            L(false);
            M([]);
            C([]);
            S(null);
          }}
        >
          Sign out
        </button>
      </header>
      <section className="metrics">
        {[
          ['Conversations', stats?.conversations],
          ['Messages', stats?.messages],
          ['Unread', stats?.unread],
          ['Failed delivery', stats?.failed],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v ?? '—'}</strong>
          </div>
        ))}
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <section className={'workspace ' + (selected ? 'opened' : '')}>
        <aside>
          <div className="listheading">
            <h2>Conversations</h2>
            <span>{list.length}</span>
          </div>
          <input
            className="search"
            aria-label="Search conversations"
            placeholder="Search name, student or phone…"
            value={query}
            onChange={e => Q(e.target.value)}
          />
          <div className="contacts">
            {list.map(c => (
              <button
                className={
                  'contact ' + (selected?.phone === c.phone ? 'active' : '')
                }
                key={c.phone}
                onClick={() => select(c)}
              >
                <div className="avatar">{(c.name || '#').slice(0, 1)}</div>
                <div className="contactbody">
                  <strong>{c.name || '+' + c.phone}</strong>
                  <small>{c.students.join(' · ') || '+' + c.phone}</small>
                  <p>{c.preview || 'Attachment'}</p>
                </div>
                {c.unread > 0 && <b className="badge">{c.unread}</b>}
              </button>
            ))}
            {!list.length && (
              <div className="empty">
                <h3>{query ? 'No matches' : 'Your inbox is ready'}</h3>
                <p>
                  {query
                    ? 'Try another name or number.'
                    : 'Conversations will appear after synchronization is configured.'}
                </p>
              </div>
            )}
          </div>
        </aside>
        <article>
          {selected ? (
            <>
              <div className="chatheading">
                <button className="back ghost" onClick={() => S(null)}>
                  ←
                </button>
                <div className="avatar">
                  {(selected.name || '#').slice(0, 1)}
                </div>
                <div>
                  <h2>{selected.name || 'Parent conversation'}</h2>
                  <small>
                    +{selected.phone} · {selected.students.join(' · ')}
                  </small>
                </div>
              </div>
              <div className="timeline">
                {messages.map(m => (
                  <div key={m.id} className={'bubble ' + m.direction}>
                    <div className="text">{m.text || '[' + m.kind + ']'}</div>
                    {m.media && (
                      <div className="attachment">
                        ▤ {m.media.filename || m.kind}
                        <small>Reference: {m.media.reference}</small>
                        {m.media.available ? (
                          <>
                            <a
                              href={
                                '/api/media?id=' +
                                encodeURIComponent(m.media.reference)
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open private attachment ↗
                            </a>
                            {m.kind === 'image' && (
                              <img
                                alt="Message attachment"
                                className="media"
                                src={
                                  '/api/media?id=' +
                                  encodeURIComponent(m.media.reference)
                                }
                              />
                            )}
                          </>
                        ) : (
                          <small>File not mirrored · reference only</small>
                        )}
                      </div>
                    )}
                    <footer>
                      <time>
                        {new Date(m.timestamp).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                      <span className={m.status}>
                        {m.direction === 'out' ? m.status : ''}
                      </span>
                    </footer>
                  </div>
                ))}
              </div>
              <div className="readonly">
                ▣ Read-only workspace · Replies and sending are managed in your
                existing application.
              </div>
            </>
          ) : (
            <div className="welcome">
              <span>◉</span>
              <h1>Conversations, in one place.</h1>
              <p>
                Select a conversation to see messages and delivery updates.
                <br />
                No campaigns. No reply box. Just clarity.
              </p>
              <div className="tag">PRIVATE • PERSISTENT • READ ONLY</div>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')).render(<App />);
