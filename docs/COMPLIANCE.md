# Compliance & privacy

This page explains *why* the defaults are what they are. The library encodes
them; your obligations as a publisher are listed at the end. Nothing here is
legal advice.

## Amazon Operating Agreement: redirects are fine, cloaking is not

The Operating Agreement does not ban redirects. What it bans (the
anti-cloaking clauses) is:

1. **obscuring which site the click came from**, and
2. **making it unclear that the link goes to Amazon.**

Branded same-domain redirects with clear labeling are the accepted pattern —
it is exactly what Geniuslink and URLgenius customers do at scale. TagFlow's
defaults keep you on the right side of both clauses:

- **Same-domain path** (`yoursite.com/go/...`), and the raw-ASIN route
  literally contains `amazon` (`/go/amazon/<asin>`).
- **Default referrer policy preserved.** The redirect response deliberately
  sets no `Referrer-Policy`, so Amazon sees the linking origin. Do not "fix"
  this with a stricter policy on redirect paths.
- **Label your CTAs** so the destination is obvious: *View on Amazon*, *Check
  price on Amazon* — not a bare *Buy now*.
- **One tag set per site.** Never inject your tags on traffic you don't own.

Sources: Associates Program Policies (linking requirements), Geniuslink
"Link Cloaking & Amazon Compliance", URLgenius Amazon policy guide.
(Reviewed 2026-07 — re-verify before relying on specifics.)

## Per-marketplace membership is required to earn

TagFlow routes a German visitor to `amazon.de` with your `de` tag — but the
commission only exists if you are enrolled in the **amazon.de Associates
program**. Every entry in `tags` implies an enrollment. New accounts also
face activation rules (qualifying sales within the first 180 days). The
router routes clicks; it cannot create payouts.

## No prices, ever

Displaying prices fetched outside Amazon's official product APIs (PA-API's
successor, the Creators API — or displaying stale prices from either)
violates the Operating Agreement. TagFlow never displays prices and never
will — deliberately out of scope, not deferred.

## Affiliate disclosure

FTC (US) and equivalent EU rules require a clear affiliate disclosure near
the links. Amazon additionally mandates its own statement. Rendering it is
your site's job; the customary line is:

> As an Amazon Associate I earn from qualifying purchases.

## Privacy (GDPR / ePrivacy)

The Worker is designed to be **consent-banner-neutral**:

- No cookies, no localStorage, no fingerprinting — a click is stateless.
- No PII stored. Analytics dimensions are aggregate-safe: ISO country code
  (not IP), marketplace, product key, resolution reason, coarse UA class.
- Analytics Engine data points are not tied to identifiable visitors.

This holds only as long as it stays true — adding a "convenient" cookie later
would silently create a consent obligation for every site running the
Worker, which is why the no-cookie rule is a hard design constraint (N2).

Privacy-policy snippet you can adapt:

> Outbound product links on this site pass through a redirect service we
> operate ourselves on Cloudflare Workers. It stores no cookies and no
> personal data; we count clicks in aggregate (country and product level
> only) to keep our links working.

## SEO hygiene

- Responses carry `X-Robots-Tag: noindex`; redirects are 302 so no link
  equity is implied.
- Mark affiliate links `rel="sponsored nofollow"` in your templates.
- Disallow the mount prefix in `robots.txt`:

  ```
  User-agent: *
  Disallow: /go/
  ```

## Trademark hygiene

The project name contains neither "Amazon" nor "Genius"; Associates policy
also forbids "amazon" in domain names — keep that in mind when choosing where
to host redirects. This project is unaffiliated with Amazon and Cloudflare.
