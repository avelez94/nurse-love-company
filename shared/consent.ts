/*
  Email list wording. Each signup records the version id and the exact text
  shown, so a change of wording becomes a new version and old consent
  records keep the words the customer actually agreed to.
*/
export const CONSENT_WORDING = {
  /** Shown when the bag holds a Freebie Corner resource. Joining is required to claim it. */
  'freebie-v1': 'Join our email list to receive this free resource, plus Nurse Love Company news, new resources, and offers. You can unsubscribe at any time.',
  /** Optional, for bags with paid items only. */
  'checkout-v1': 'Join our email list for Nurse Love Company news, new resources, and offers. You can unsubscribe at any time.',
  /** The account settings checkbox. */
  'account-v1': 'News and new products: Nurse Love Company news, new resources, and offers by email. You can unsubscribe at any time.',
} as const

export type ConsentVersion = keyof typeof CONSENT_WORDING

/** The customer's current list status, as checkout and the account show it. */
export interface MarketingStatus {
  status: 'subscribed' | 'unsubscribed' | 'never'
  since: string | null
}
