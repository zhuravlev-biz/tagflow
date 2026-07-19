import type { Decision } from '@tagflow/core'

/**
 * Escapes text for both HTML content and (double-quoted) attribute contexts
 * (F14). One helper for both since the entity set that matters — `&`, `<`,
 * `>`, `"`, `'` — is the same either way.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Best-effort hostname for the secondary "where this goes" line (F14). */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Renders a self-contained choice page (F14): no script, no external
 * assets, inline CSS only — this ships in a Worker bundle and must render
 * correctly with nothing but the HTML response itself. Caching/SEO headers
 * are the handler's job, not this function's (F14 §4).
 */
export function renderChoicePage(decision: Extract<Decision, { type: 'choice' }>): string {
  const productKey = escapeHtml(decision.productKey)
  const links = decision.entries
    .map((entry) => {
      const href = escapeHtml(entry.url)
      const label = escapeHtml(entry.label)
      const host = escapeHtml(hostOf(entry.url))
      const hostLine = host === '' ? '' : `
          <span class="option-host">${host}</span>`
      return `
        <a class="option" href="${href}" rel="sponsored nofollow noopener">
          <span class="option-label">View on ${label}</span>${hostLine}
        </a>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Choose a store · ${productKey}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f5f7;
    color: #1c1c1e;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: #ffffff;
    border-radius: 16px;
    padding: 32px 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    text-align: center;
  }
  h1 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 24px;
    word-break: break-word;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    border-radius: 10px;
    background: #0066ff;
    color: #ffffff;
    text-decoration: none;
    font-weight: 600;
  }
  .option-label { font-size: 1rem; }
  .option-host {
    font-size: 0.75rem;
    font-weight: 400;
    opacity: 0.85;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #000000; color: #f2f2f7; }
    .card { background: #1c1c1e; box-shadow: none; }
    .option { background: #0a84ff; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Choose where to buy: ${productKey}</h1>
    <div class="options">${links}
    </div>
  </main>
</body>
</html>
`
}
