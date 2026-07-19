/** Minimal fixed-width table printer shared by commands that report tabular results. */
export function printTable(header: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => (row[col] ?? '').length)),
  )
  const format = (row: readonly string[]): string =>
    row.map((cell, col) => (cell ?? '').padEnd(widths[col] ?? 0)).join('  ')
  console.log(format(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(format(row))
}
