// core must stay platform-free: no DOM and no Node typings, so nothing can
// reach for `window`, `document`, `fetch` or `process` by accident. Every
// runtime core targets (browsers, service workers, Cloudflare Workers,
// Node >= 10) ships the WHATWG URL API, so this declares only the part of it
// that amazon-url.ts uses. It is not emitted: consumers resolve `URL` from
// their own environment's lib.

interface URLSearchParams {
  get(name: string): string | null
  has(name: string): boolean
  delete(name: string): void
}

interface URL {
  readonly protocol: string
  readonly hostname: string
  readonly pathname: string
  search: string
  readonly searchParams: URLSearchParams
  readonly href: string
  toString(): string
}

declare const URL: {
  new (url: string | URL, base?: string | URL): URL
  readonly prototype: URL
}
