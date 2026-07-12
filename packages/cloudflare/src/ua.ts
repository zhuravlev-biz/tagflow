import type { UaClass } from './types.js'

// Goal: bot flagging for analytics, not perfect detection (§8). Deliberately
// a small heuristic instead of a UA-parser dependency.
const BOT_RE =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|curl\/|wget\/|python-requests|httpclient|okhttp/i
const MOBILE_RE = /mobi|android|iphone|ipad|ipod/i

export function classifyUserAgent(userAgent: string | null | undefined): UaClass {
  if (userAgent == null || userAgent.length === 0) return 'bot'
  if (BOT_RE.test(userAgent)) return 'bot'
  if (MOBILE_RE.test(userAgent)) return 'mobile'
  return 'desktop'
}
