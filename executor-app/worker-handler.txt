// TRIAGE_DATA is prepended by npm run build. No credentials or review traffic.
addEventListener('fetch', event => event.respondWith(serveFeed(event.request)));

async function serveFeed(request) {
  if (new URL(request.url).pathname !== '/v1/triage.json')
    return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(TRIAGE_DATA), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': 'https://stardance.hackclub.com',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
