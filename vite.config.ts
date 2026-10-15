import { defineConfig, type Plugin } from 'vite';

/**
 * Serve the /api functions during `npm run dev` with an in-memory store, so the leaderboard
 * and online rooms work locally without Upstash. Vercel runs the real functions in production.
 */
function devApi(): Plugin {
  return {
    name: 'sssnake-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return;
      process.env.SSSNAKE_DEV_MEMORY = '1';
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/(scores|room)(?:\?|$)/.exec(req.url ?? '');
        if (!m) return next();
        try {
          const mod = (await server.ssrLoadModule(`/api/${m[1]}.js`)) as Record<string, (r: Request) => Promise<Response>>;
          const handler = mod[req.method ?? 'GET'];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] ?? 'application/json', 'x-forwarded-for': '127.0.0.1' },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const out = await handler(request);
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
  build: { target: 'es2022' },
});
