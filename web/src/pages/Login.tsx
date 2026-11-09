import { useState } from "react";
import { api } from "../api";

export function Login({ onLogin, hint }: { onLogin: () => void; hint: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/login", {
              method: "POST",
              body: JSON.stringify({ password }),
            });
            onLogin();
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand big">
          <span className="brand-mark">b2c</span>
          <div>
            <strong>bring2continente</strong>
            <small>lista → carrinho</small>
          </div>
        </div>
        <p className="muted">Entra para ver e controlar a sincronização.</p>
        {hint && <div className="alert info">{hint}</div>}
        {error && <div className="alert error">{error}</div>}
        <label>
          Palavra-passe
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "A entrar…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
