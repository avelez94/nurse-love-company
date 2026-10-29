export function formatPrice(cents: number | null): string {
  if (cents === null) return 'Pricing to be added'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
