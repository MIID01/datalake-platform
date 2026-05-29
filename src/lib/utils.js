// Small utilities shared across pages.

// English ordinal suffix for a number — 1st, 2nd, 3rd, 4th, ..., 11th, 12th, 13th,
// 21st, 22nd, 23rd, 31st. Always use this instead of hardcoding "{n}th" so we
// don't ship grammar like "1th" again.
export function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
