// Dev-only fake IPTV provider served by `pnpm dev` under /__fixtures (apply: 'serve' keeps it out of
// every build). Lets the browser prototype be tested without real provider accounts.
//
//   Xtream: server http://localhost:<port>/__fixtures/xtream  user/pass  demo/demo · big/big · slow/slow
//   M3U:    http://localhost:<port>/__fixtures/m3u/demo.m3u   (or big.m3u)
//   GET /__fixtures/bump  renumbers every stream (tests that favourites survive a refresh)
//   Streams, EPG and outages: see media-server.ts (needs node scripts/make-test-media.mjs once)
//
// Like many real providers, the API and M3U allow cross-origin requests but streams don't: open the
// app at localhost and use server 127.0.0.1 to test the "provider blocks browsers" fallback.
import type { Plugin } from 'vite';
import { MOCK_ACCOUNTS, mockLogoSvg, mockM3u, mockXtream } from '../../../packages/core/src/testing/mock-provider.ts';
import { handleMedia } from './media-server.ts';

export function devFixtures(): Plugin {
  let generation = 0;
  return {
    name: 'ultra-dev-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixtures', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const origin = `http://${req.headers.host}`;
        const send = (status: number, type: string, body: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', type);
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        };
        if (url.pathname === '/bump') {
          generation++;
          return send(200, 'application/json', JSON.stringify({ generation }));
        }
        if (handleMedia(url.pathname, url.searchParams, req, res)) return;
        const logo = /^\/logo\/(\d+)\.svg$/.exec(url.pathname);
        if (logo) return send(200, 'image/svg+xml', mockLogoSvg(Number(logo[1])));
        if (url.pathname === '/xtream/player_api.php') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          const user = url.searchParams.get('username') ?? '';
          const body = JSON.stringify(
            mockXtream(
              url.searchParams.get('action'),
              user,
              url.searchParams.get('password') ?? '',
              generation,
              origin,
              url.searchParams.get('stream_id') ?? url.searchParams.get('vod_id') ?? url.searchParams.get('series_id'),
            ),
          );
          const delay = MOCK_ACCOUNTS[user]?.delayMs ?? 0;
          setTimeout(() => send(200, 'application/json', body), delay);
          return;
        }
        const m3u = /^\/m3u\/(\w+)\.m3u$/.exec(url.pathname);
        if (m3u) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          const body = mockM3u(m3u[1], generation, origin);
          return body ? send(200, 'audio/x-mpegurl', body) : send(404, 'text/plain', 'unknown list');
        }
        send(404, 'text/plain', 'not found');
      });
    },
  };
}
