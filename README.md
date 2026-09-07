# 3D Connect6

A three-dimensional Connect6 game with browser-based AI and a Cloudflare Durable Objects multiplayer server.

- Play: https://3d-connect6.pages.dev
- Rules: [RULES.md](RULES.md)
- Multiplayer Worker: `connect6-server.1310205058.workers.dev`

## Development

Use Node.js 22 or later:

```sh
npm ci
npm run build -w packages/shared
npm run dev:server
```

In another terminal, run `npm run dev`. For a local or custom-domain frontend, set `VITE_API_URL` to the intended Worker origin in `packages/client/.env.local` (for example `http://localhost:8787` locally), then restart or rebuild the client.

## Verification

```sh
npm run build
npm test -w packages/shared
npm run typecheck -w packages/server
```

GitHub Actions runs these checks for pull requests and pushes to `main`. They cover compilation and game rules; they do not substitute for a browser and multiplayer smoke test.

## Deployment

After authenticating Wrangler with the intended Cloudflare account:

```sh
npm run deploy:worker
npm run deploy:pages
```

The frontend command targets the existing Pages project `3d-connect6`. The different hostname `connect6.pages.dev` serves another page and is not this application's verified entry point. Run production deployments from the production branch; Wrangler derives the deployment branch from Git.

The Worker configuration lives in `packages/server/wrangler.toml`. Keep the client `VITE_API_URL` aligned with that Worker when changing domains. Do not place Cloudflare account tokens in frontend environment variables.
