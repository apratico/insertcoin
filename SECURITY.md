# Security policy

## Reporting a vulnerability

If you find a security issue (data exposure, auth bypass, RLS gap, XSS, dependency CVE), please report it privately:

- Open a [GitHub Security Advisory](https://github.com/apratico/insertcoin/security/advisories/new) on this repo, or
- Email **alessandro.pratico@decisyon.com** with the subject `insertcoin security`.

Please do **not** open a public issue for security reports.

I aim to respond within 7 days.

## Scope

This is a hobby/portfolio project. There is no bug bounty.

In scope:
- Code in this repository
- Live deployment if/when one is published
- Any package shipped from this repo

Out of scope:
- Third-party dependencies (report upstream)
- Social engineering
- DoS via flood / brute force

## Supabase credentials

The app uses a Supabase project with the **anon** (public) key. By Supabase design, the anon key is intended to be embedded in client-side bundles and is protected by Row Level Security (RLS) policies on every table and RPC.

If you self-host:
1. Create your own Supabase project.
2. Configure RLS on every table (`scores`, `profiles`, `visits`, `game_opens`, ...) before going to production.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in your deploy environment (e.g. Cloudflare Pages env vars).
4. Never commit a `service_role` key. Anywhere. Ever.

## Hardening checklist

- [x] `.env` and `.env.*` git-ignored (except `.env.example`)
- [x] No `service_role` key in source or git history
- [x] Anon key not hardcoded in tracked source
- [ ] RLS audited on every table and RPC (responsibility of project owner / self-hoster)
- [ ] Rate limiting on score submission RPC (recommended)
