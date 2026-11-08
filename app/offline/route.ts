// /offline — the page the service worker shows when a page can't load.
// Self-contained HTML (no app layout, scripts or data), so it renders from
// the service worker's cache with no network. Public (see proxy.ts).
// The colours repeat the ui-context.md tokens: this page can't load
// globals.css when offline.
const HTML = `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E1116">
<title>Offline · Donquixote</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { --bg-base: #0E1116; --bg-surface: #171B22; --text-primary: #E8EAED; --text-muted: #9AA3AE; --accent-primary: #F5B544; --border-input: #333B47; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg-base); color: var(--text-primary); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; }
  main { width: 100%; max-width: 480px; padding: calc(48px + env(safe-area-inset-top)) 24px 24px; display: flex; flex-direction: column; gap: 24px; }
  img { width: 72px; height: 72px; border-radius: 18px; }
  h1 { margin: 0; font-size: 28px; line-height: 1.2; letter-spacing: -0.02em; }
  p { margin: 8px 0 0; color: var(--text-muted); }
  button { height: 52px; border-radius: 12px; border: 1px solid var(--border-input); background: var(--bg-surface); color: var(--text-primary); font: 600 16px system-ui, sans-serif; }
</style>
</head>
<body>
<main>
  <img src="/icon-192.png" alt="" width="72" height="72">
  <div>
    <h1>No connection</h1>
    <p>You're offline. Alerts still arrive by push and email when you reconnect.</p>
  </div>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;

export function GET(): Response {
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
