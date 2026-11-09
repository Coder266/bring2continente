import { NavLink, Outlet } from "react-router-dom";
import { when } from "../api";
import type { Status } from "../types";

const links = [
  { to: "/", label: "Painel", end: true },
  { to: "/queue", label: "Rever" },
  { to: "/mappings", label: "Mapeamentos" },
  { to: "/checkout", label: "Checkout" },
  { to: "/rules", label: "Regras" },
  { to: "/events", label: "Eventos" },
];

export function Layout({ status, onLogout }: { status: Status | null; onLogout: () => void }) {
  const review = status?.counts.needsReview ?? 0;
  const checkout = status?.pendingCheckout ?? 0;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">b2c</span>
          <div>
            <strong>bring2continente</strong>
            <small>lista → carrinho</small>
          </div>
        </div>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? "nav active" : "nav")}
            >
              <span>{link.label}</span>
              {link.to === "/queue" && review > 0 && <em className="pill">{review}</em>}
              {link.to === "/checkout" && checkout > 0 && <em className="pill">{checkout}</em>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-line">
            <i className={status?.bring.ok ? "dot ok" : "dot bad"} />
            Bring! {status?.bring.listName ? `· ${status.bring.listName}` : ""}
          </div>
          <div className="status-line">
            <i className={status?.continente.ok ? "dot ok" : "dot bad"} />
            Continente
          </div>
          <small className="muted">Último poll: {when(status?.lastPollAt)}</small>
          <button type="button" className="link" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
