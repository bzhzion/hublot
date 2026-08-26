# Hublot showcase site

Static HTML/CSS/JS, no build step, no framework. Same pattern as the
`site/` folder in `bzhzion/beammeup`: a Cloudflare Pages project pointed
directly at this repo, root directory `site`, no build command.

Not deployed yet from this task (no Cloudflare access available here). To
deploy later:

1. Create a Cloudflare Pages project, source = this GitHub repo (`main`
   branch), root directory `site`.
2. Build watch paths: use `path_includes: ["*"]` with
   `path_excludes` for anything that should *not* trigger a redeploy (for
   example `src/*`, `.github/*`), never `site/**`. Cloudflare Pages treats
   `**` as a literal, unmatched path segment, not a recursive glob: see the
   trap already documented for beammeup in `admin/docs/beammeup.md`.
3. Point a CNAME (`hublot.breizhzion.com` or similar) at the resulting
   `*.pages.dev` project, proxied, in the `breizhzion.com` Cloudflare zone.

Fonts (Fraunces, IBM Plex Sans, IBM Plex Mono) are loaded from Google
Fonts directly rather than self-hosted, since this site has no CSP of its
own to fight (unlike the packaged app).
