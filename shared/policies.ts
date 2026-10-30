/*
  Terms & Conditions and Privacy Policy. The owner edits a draft made of
  sections; Publish stores a snapshot with the date, and only when every
  section is marked reviewed and no [PLACEHOLDER] text is left. The starter
  drafts describe how this store actually works, and leave business details
  (names, addresses, refund terms, retention periods, governing law) as
  placeholders for the owner. They are drafts, not legal advice.

  Section text: paragraphs separated by a blank line, list items on lines
  starting with "* ", and links written [label](#page) or [label](https://...).
*/
import { isSafeHref } from './faq.js'

export const POLICY_KEYS = ['terms', 'privacy'] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

export const POLICY_META: Record<PolicyKey, { title: string; route: string }> = {
  terms: { title: 'Terms & Conditions', route: 'terms' },
  privacy: { title: 'Privacy Policy', route: 'privacy' },
}

export interface PolicySection {
  id: string
  heading: string
  body: string
  /** The owner has read and confirmed this section. Required for every section before publishing. */
  reviewed: boolean
  /** Private guidance for the owner. Never published. */
  ownerNote: string
}

export interface PolicyDraft {
  intro: string
  sections: PolicySection[]
}

export interface PublishedPolicy {
  intro: string
  sections: Array<{ id: string; heading: string; body: string }>
  /** When this version was published (ISO date time). */
  lastUpdated: string
}

const ID = /^[a-z0-9_-]{1,40}$/i
const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)

const LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,500})\)/g
const PLACEHOLDER = /\[(?:[A-Z][A-Z0-9 ,&'/-]{2,}|OWNER TO [A-Z ]+:[^\]]*)\]/

/** Text such as [SUPPORT EMAIL] or [OWNER TO CONFIRM: ...] that must be replaced before publishing. */
export const hasPlaceholder = (text: string) => PLACEHOLDER.test(text.replace(LINK, '$1'))
const MARKUP = /<\s*\/?\s*[a-z]/i

/** Throws with a message the editor can show. */
export function normalizePolicy(input: unknown): PolicyDraft {
  const raw = (input ?? {}) as Record<string, unknown>
  const sections = Array.isArray(raw.sections) ? raw.sections : []
  if (sections.length > 40) throw new Error('Keep to 40 sections or fewer.')
  const seen = new Set<string>()
  const out: PolicyDraft = {
    intro: clean(raw.intro, 2000),
    sections: sections.map((s: any, i: number) => {
      let id = String(s?.id ?? '')
      if (!ID.test(id) || seen.has(id)) id = `section-${i + 1}-${Math.random().toString(36).slice(2, 7)}`
      seen.add(id)
      return { id, heading: clean(s?.heading, 120), body: clean(s?.body, 8000), reviewed: s?.reviewed === true, ownerNote: clean(s?.ownerNote, 1000) }
    }),
  }
  for (const text of [out.intro, ...out.sections.flatMap((s) => [s.heading, s.body])]) {
    if (MARKUP.test(text)) throw new Error('Policies are plain text. Remove any HTML tags.')
    for (const l of text.matchAll(LINK)) if (!isSafeHref(l[2])) throw new Error(`The link "${l[1]}" must go to a page on this site (like #help) or a full https:// address.`)
  }
  return out
}

/** Why the draft cannot be published yet. Empty when it can. */
export function policyProblems(d: PolicyDraft): string[] {
  const p: string[] = []
  const filled = d.sections.filter((s) => s.heading || s.body)
  if (!filled.length) p.push('Add at least one section.')
  for (const s of filled) {
    const name = s.heading || 'A section without a heading'
    if (!s.heading || !s.body) p.push(`"${name}" needs both a heading and text.`)
    if (hasPlaceholder(`${s.heading}\n${s.body}`)) p.push(`"${name}" still has [PLACEHOLDER] text to replace.`)
    if (!s.reviewed) p.push(`"${name}" is not marked reviewed.`)
  }
  if (hasPlaceholder(d.intro)) p.push('The introduction still has [PLACEHOLDER] text to replace.')
  return p
}

export function publishedSnapshot(d: PolicyDraft, at: Date): PublishedPolicy {
  return { intro: d.intro, sections: d.sections.filter((s) => s.heading && s.body).map(({ id, heading, body }) => ({ id, heading, body })), lastUpdated: at.toISOString() }
}

export type Inline = { type: 'text'; text: string } | { type: 'link'; label: string; href: string }
export type PolicyBlock = { type: 'p'; parts: Inline[] } | { type: 'list'; items: Inline[][] }

function inline(text: string): Inline[] {
  const parts: Inline[] = []
  let last = 0
  for (const l of text.matchAll(LINK)) {
    if (l.index! > last) parts.push({ type: 'text', text: text.slice(last, l.index) })
    parts.push(isSafeHref(l[2]) ? { type: 'link', label: l[1], href: l[2] } : { type: 'text', text: l[1] })
    last = l.index! + l[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

/** Splits section text into paragraphs and lists. */
export function parsePolicyBody(body: string): PolicyBlock[] {
  return body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap((block): PolicyBlock[] => {
      const lines = block.split('\n')
      if (lines.every((l) => l.startsWith('* '))) return [{ type: 'list', items: lines.map((l) => inline(l.slice(2).trim())) }]
      return [{ type: 'p', parts: inline(lines.join(' ')) }]
    })
}

const s = (id: string, heading: string, body: string, ownerNote = ''): PolicySection => ({ id, heading, body, reviewed: false, ownerNote })

export function starterPolicy(key: PolicyKey): PolicyDraft {
  return key === 'terms' ? starterTerms() : starterPrivacy()
}

function starterTerms(): PolicyDraft {
  return {
    intro: 'These terms explain how ordering from Nurse Love Company works. Please read them before you place an order or claim a free resource.',
    sections: [
      s(
        'about',
        'About these terms',
        'Nurse Love Company is run by [BUSINESS LEGAL NAME]. These terms apply when you use this website, create an account, place an order, or claim a free resource. By placing an order or claiming a free resource, you agree to these terms.',
        'Add the legal name of the person or business that runs the store.',
      ),
      s(
        'accounts',
        'Your account',
        'You need an account to check out, claim a free resource, download files, and leave reviews. Please use an email address you can access, and keep your password private. You can update your details in [account settings](#account-settings).',
      ),
      s(
        'products',
        'What we sell',
        'We sell two kinds of products:\n\n* Digital products, such as printable binder inserts and study resources, delivered as files you download from your account.\n* Physical merchandise, such as apparel, accessories, and pens, shipped to the address you give at checkout.\n\nEach product description explains its contents and format. Our resources are educational and organizational tools to use alongside your course materials and professional references. They are not medical advice and do not replace your coursework, professional references, or clinical judgment.',
        'The last paragraph reuses wording from your Our Story page. Confirm it fits, and add anything your products need.',
      ),
      s(
        'orders',
        'Orders, prices, and payment',
        'Prices are shown in US dollars. Shipping and any sales tax are calculated at checkout before you pay. Payments are processed by Stripe on its secure checkout page; we do not receive or store your full card number.\n\nAfter your order is paid, you receive an order confirmation by email, and your order appears in your [order history](#account-orders).',
        'Payments are not connected on the live site yet. Check this section again once Stripe is set up.',
      ),
      s(
        'downloads',
        'Digital downloads: one download per purchase',
        'Each purchase of a digital product includes one download of its file, from the [Downloads](#account-downloads) page in your account. Download links are tied to your account and expire shortly after they are created. Please save the file somewhere safe once it has downloaded.\n\nIf a download fails because of a genuine technical problem, contact us and we will look into it. Any replacement download is at our discretion.',
        'This matches how the store works: one download per purchase, and replacements are granted by an admin with a recorded reason.',
      ),
      s(
        'updates',
        'Updated digital files',
        'Sometimes we improve a digital product. When we release an updated version, customers who bought that product receive one download of the new version in their account, and may receive an email letting them know. If you have not downloaded your purchase yet, your download gives you the newest version.',
      ),
      s(
        'use',
        'How you may use digital files',
        '[OWNER TO CONFIRM: how customers may use digital files, for example personal use only, and whether sharing, reselling, or printing for others is allowed.]',
        'Only you can decide this. Replace the bracketed text with your own terms.',
      ),
      s(
        'freebies',
        'Free resources (The Freebie Corner)',
        'Free resources are claimed through a short checkout with your account; no payment details are needed. Claiming a free resource includes joining our email list, as shown before you claim it. You can unsubscribe at any time, and you keep the free resource. Like paid digital products, each free resource includes one download.',
      ),
      s(
        'refunds',
        'Refunds, returns, and cancellations',
        '[OWNER TO PROVIDE: your refund, return, exchange, and cancellation terms for digital products and for physical merchandise.]',
        'Not written for you. The store is currently set so that if a digital item is fully refunded before it is downloaded, its download is canceled (Settings, Policies). Describe that here if it matches your terms.',
      ),
      s(
        'shipping',
        'Shipping and delivery',
        'Shipping charges are shown at checkout before you pay. [OWNER TO PROVIDE: where you ship, typical processing and delivery times, who fulfills orders, and what happens if a parcel is lost or arrives damaged.]',
        'Printful is a possible future fulfillment partner but is not connected. Do not name it here unless you start using it.',
      ),
      s(
        'reviews',
        'Product reviews',
        'Customers who bought a product can leave one review of it, with a star rating, a title, their review, and the display name they choose. Reviews are checked before they appear, and we may decline reviews that are off topic, abusive, or include personal information. We may reply to reviews publicly. Anyone can report a review for us to look at again.',
        'Confirm these moderation rules match how you want to handle reviews.',
      ),
      s(
        'content',
        'Our content',
        'The text, designs, images, and files on this website and in our products belong to [BUSINESS LEGAL NAME] unless stated otherwise.',
        'Confirm ownership, and mention anything you license from others (for example fonts or graphics).',
      ),
      s(
        'law',
        'Governing law',
        '[OWNER TO CONFIRM: the state or country whose laws apply to these terms.]',
        'A qualified adviser can help with this section.',
      ),
      s('changes', 'Changes to these terms', 'We may update these terms from time to time. The date at the top of this page shows when they were last updated.'),
      s('contact', 'Contact us', 'Questions about these terms? Email [SUPPORT EMAIL] or visit [Help & contact](#help).', 'Add the support email customers should use. It should be the store contact, not the website builder.'),
    ],
  }
}

function starterPrivacy(): PolicyDraft {
  return {
    intro: 'This policy explains what information Nurse Love Company collects, why, and the choices you have.',
    sections: [
      s('who', 'Who we are', 'Nurse Love Company is run by [BUSINESS LEGAL NAME]. You can reach us at [SUPPORT EMAIL].', 'Add the legal name and the store support email. Add a mailing address if you have one to share.'),
      s(
        'give',
        'Information you give us',
        '* Account details: your name, email address, and password. Passwords are stored only in a scrambled (hashed) form.\n* Orders: the items you buy, amounts, the billing details our payment provider shares with us, and a shipping address for physical items.\n* Email list: if you join, your email address, the wording you agreed to, when you agreed, and your IP address, kept as a record of your consent.\n* Reviews: your rating, title, review, and the display name you choose.\n* Support requests: what you write to us and the order it is about.',
      ),
      s(
        'automatic',
        'Information collected automatically',
        '* Downloads: when you download a file, we record the date, your IP address, and basic browser details, to keep the one download rule fair and to help if something goes wrong.\n* Security: sign in activity and some account actions are recorded to protect your account.\n* The resource quiz: we count how many people start and finish it and which suggested products are clicked. Your quiz answers are not stored.\n\nWe do not use analytics or advertising trackers.',
        'Accurate for the store as built. If you ever add analytics (for example Vercel Analytics or Google Analytics), update this section first.',
      ),
      s(
        'cookies',
        'Cookies and browser storage',
        'We use one essential cookie to keep you signed in. Your browser also stores your bag, banners you have closed, and where to return after you sign in. We do not use advertising cookies.\n\nOur fonts load from Google Fonts, so Google receives your IP address when a page loads.',
      ),
      s(
        'use',
        'How we use your information',
        '* To process orders, deliver downloads, and ship physical items.\n* To send receipts, account emails, and notices about updated files you bought.\n* To send occasional reminders, such as a reminder to download your purchase or a request to review it. Each of these emails has a link to turn that kind of email off.\n* To send news, new resources, and offers, only if you joined our email list.\n* To answer support requests, keep the store secure, and prevent misuse.',
      ),
      s(
        'services',
        'Services we use',
        'We use trusted service providers to run the store. They handle your information only to provide their service:\n\n* Vercel, to host the website.\n* Supabase, to store our database and files.\n* Stripe, to process payments.\n* Resend, to send emails and manage our email list.\n* Google Fonts, to provide the website fonts.',
        'Keep this list to services actually in use. Check the Services panel on this page: today Vercel and Supabase are connected, while Stripe and Resend are built in but not yet connected. Printful is only planned. Update the list before publishing if anything differs.',
      ),
      s(
        'choices',
        'Emails and your choices',
        'Receipts and account emails are always sent, because they are part of your order and account.\n\nYou can leave our email list at any time using the unsubscribe link in any marketing email or the email setting in your [account](#account-settings). Reminder and review request emails each include a link to turn them off.',
      ),
      s('sharing', 'Sharing your information', 'We do not sell your personal information. We share it only with the services listed above, as needed to run the store, or when the law requires it.', 'Confirm this is true for your business.'),
      s(
        'retention',
        'How long we keep information',
        '[OWNER TO CONFIRM: how long you keep account, order, and email list records.] Records of email list consent are kept as proof of your choice.',
        'Not written for you. Order records are often kept for tax purposes; ask a qualified adviser what applies to you.',
      ),
      s(
        'rights',
        'Your rights',
        'You can update your account details in [account settings](#account-settings). To ask for a copy of your information or for it to be deleted, email [SUPPORT EMAIL]. Depending on where you live, you may have other rights under local law.',
        'Requests are handled by you manually today. A qualified adviser can confirm which privacy laws apply to you.',
      ),
      s('children', 'Children', '[OWNER TO CONFIRM: the minimum age to create an account or order, if any.]', 'The store does not check ages today.'),
      s(
        'security',
        'Keeping information safe',
        'Passwords are hashed, files are kept in private storage and delivered through short lived links, and card details are handled by our payment provider. No method of storage or transfer is completely secure, but we work to protect your information.',
      ),
      s('changes', 'Changes to this policy', 'We may update this policy from time to time. The date at the top of this page shows when it was last updated.'),
      s('contact', 'Contact us', 'Questions about your privacy? Email [SUPPORT EMAIL] or visit [Help & contact](#help).', 'Use the store support email, not the website builder.'),
    ],
  }
}
