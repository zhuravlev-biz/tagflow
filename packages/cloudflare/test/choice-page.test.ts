import type { Decision } from '@tagflow/core'
import { describe, expect, it } from 'vitest'
import { renderChoicePage } from '../src/choice-page.js'

function choiceDecision(entries: Extract<Decision, { type: 'choice' }>['entries']): Extract<
  Decision,
  { type: 'choice' }
> {
  return { type: 'choice', productKey: 'widget', entries }
}

describe('renderChoicePage', () => {
  it('renders one link per entry with the expected href and rel attribute', () => {
    const html = renderChoicePage(
      choiceDecision([
        { key: 'amazon', label: 'Amazon', url: 'https://www.amazon.de/dp/B000000001?tag=t-21' },
        { key: 'bol', label: 'Bol.com', url: 'https://www.bol.com/x' },
      ]),
    )
    expect(html).toContain('href="https://www.amazon.de/dp/B000000001?tag=t-21"')
    expect(html).toContain('href="https://www.bol.com/x"')
    expect((html.match(/rel="sponsored nofollow noopener"/g) ?? []).length).toBe(2)
  })

  it('shows visible text containing "Amazon" for the amazon entry', () => {
    const html = renderChoicePage(
      choiceDecision([
        { key: 'amazon', label: 'Amazon', url: 'https://www.amazon.de/dp/B000000001?tag=t-21' },
      ]),
    )
    expect(html).toMatch(/>[^<]*Amazon[^<]*</)
  })

  it('escapes a malicious label so no raw <script> tag reaches the document', () => {
    const html = renderChoicePage(
      choiceDecision([
        { key: 'evil', label: '<script>alert(1)</script>', url: 'https://evil.example/x' },
      ]),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('attribute-escapes a URL containing "&" and \'"\'', () => {
    const html = renderChoicePage(
      choiceDecision([
        { key: 'bol', label: 'Bol.com', url: 'https://www.bol.com/x?a=1&b="2"' },
      ]),
    )
    expect(html).toContain('href="https://www.bol.com/x?a=1&amp;b=&quot;2&quot;"')
    expect(html).not.toContain('href="https://www.bol.com/x?a=1&b="2""')
  })

  it('is a complete, self-contained, non-indexable document', () => {
    const html = renderChoicePage(
      choiceDecision([
        { key: 'amazon', label: 'Amazon', url: 'https://www.amazon.de/dp/B000000001?tag=t-21' },
        { key: 'bol', label: 'Bol.com', url: 'https://www.bol.com/x' },
      ]),
    )
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('src=')
    // The only https:// occurrences must be the two entry hrefs above.
    expect((html.match(/https:\/\//g) ?? []).length).toBe(2)
  })

  it('renders the product key, escaped, without prettifying it', () => {
    const html = renderChoicePage(
      choiceDecision([{ key: 'amazon', label: 'Amazon', url: 'https://www.amazon.de/dp/x' }]),
    )
    const withSlug = renderChoicePage({
      type: 'choice',
      productKey: 'a<b>-slug',
      entries: [{ key: 'amazon', label: 'Amazon', url: 'https://www.amazon.de/dp/x' }],
    })
    expect(html).toContain('widget')
    expect(withSlug).toContain('a&lt;b&gt;-slug')
    expect(withSlug).not.toContain('a<b>-slug')
  })
})
