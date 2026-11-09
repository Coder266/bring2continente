# Security

This project handles two personal accounts and can change a real shopping cart.

- **Never paste credentials, cookies, or `.env` files into an issue.** Use GitHub's private
  security advisory flow instead.
- The service has no authentication bypass by design: the web UI is gated by `WEB_PASSWORD`
  and a signed session cookie. Bind it to loopback or a private network (Tailscale, LAN) and
  set `SECURE_COOKIES=1` when it is behind HTTPS.
- Report vulnerabilities through
  [GitHub Security Advisories](https://github.com/Coder266/bring2continente/security/advisories).
