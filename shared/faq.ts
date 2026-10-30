/*
  Help & FAQs: content shape, validation, starter drafts and the public view,
  shared by the server (validation, publishing) and the browser (rendering,
  search and the admin preview).

  Answers are plain text. Blank lines separate paragraphs. Two small extras:
  * Links: [label](#page-on-this-site) or [label](https://example.com).
    The special link #find-my-resources opens the resource quiz panel.
  * Conditions: a paragraph that starts with {{if quiz}} is shown only while
    a resource quiz is published; {{if tutorials}} only while at least one
    tutorial is published.

  Only questions the owner approved are ever published. An answer still
  containing a placeholder such as [SUPPORT EMAIL] cannot be approved, and
  owner notes and approval flags never leave the admin.
*/

export interface FaqQuestion {
  id: string
  question: string
  answer: string
  keywords: string[]
  /** Explicitly approved by the owner for publishing. */
  approved: boolean
  /** Starter answers marked for the owner to confirm. Admin only. */
  needsConfirmation: boolean
  /** Implementation or review note. Admin only, never public. */
  ownerNote: string
}

export interface FaqCategory {
  id: string
  title: string
  questions: FaqQuestion[]
}

export interface FaqContact {
  email: string
  hours: string
  timezone: string
  responseTime: string
}

export interface FaqContent {
  heading: string
  intro: string
  contact: FaqContact
  categories: FaqCategory[]
}

export interface PublicFaqQuestion {
  id: string
  question: string
  answer: string
  keywords: string[]
}
export interface PublicFaq {
  heading: string
  intro: string
  contact: Partial<FaqContact>
  categories: Array<{ id: string; title: string; questions: PublicFaqQuestion[] }>
}

export type Condition = 'quiz' | 'tutorials'
export type AnswerPart = { type: 'text'; text: string } | { type: 'link'; label: string; href: string }
export interface AnswerParagraph {
  condition: Condition | null
  parts: AnswerPart[]
}

const PLACEHOLDER = /\[[A-Z][A-Z0-9 ,&'/-]{2,}\]/
const LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,500})\)/g
const CONDITION = /^\{\{\s*if\s+(quiz|tutorials)\s*\}\}\s*/

/** Text such as [SUPPORT EMAIL] or [OWNER TO CONFIRM] that must be replaced before publishing. */
export const hasPlaceholder = (s: string) => PLACEHOLDER.test(s.replace(LINK, '$1'))

export function isSafeHref(href: string) {
  if (/^#[a-z0-9][a-z0-9-]*$/.test(href)) return true
  try {
    const u = new URL(href)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** Splits an answer into paragraphs of text and links, with any display condition. */
export function parseAnswer(answer: string): AnswerParagraph[] {
  return answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(CONDITION)
      const body = m ? p.slice(m[0].length) : p
      const parts: AnswerPart[] = []
      let last = 0
      for (const l of body.matchAll(LINK)) {
        if (l.index! > last) parts.push({ type: 'text', text: body.slice(last, l.index) })
        parts.push(isSafeHref(l[2]) ? { type: 'link', label: l[1], href: l[2] } : { type: 'text', text: l[1] })
        last = l.index! + l[0].length
      }
      if (last < body.length) parts.push({ type: 'text', text: body.slice(last) })
      return { condition: (m?.[1] as Condition | undefined) ?? null, parts }
    })
}

/** The answer as plain words (link labels kept), for search. */
export const answerText = (paragraphs: AnswerParagraph[]) => paragraphs.map((p) => p.parts.map((x) => (x.type === 'text' ? x.text : x.label)).join('')).join(' ')

const ID = /^[a-z0-9_-]{1,40}$/i
const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)

/** Cleans and checks untrusted input. Throws a readable message on anything that cannot be saved. */
export function normalizeFaq(input: unknown): FaqContent {
  const b = (input ?? {}) as Record<string, any>
  const ids = new Set<string>()
  const id = (v: unknown, prefix: string) => {
    let s = String(v ?? '')
    if (!ID.test(s) || ids.has(s)) s = `${prefix}${Math.random().toString(36).slice(2, 8)}`
    ids.add(s)
    return s
  }
  const contact = (b.contact ?? {}) as Record<string, unknown>
  const email = clean(contact.email, 200)
  if (email && !hasPlaceholder(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('The contact email is not a valid email address.')
  const categories: FaqCategory[] = (Array.isArray(b.categories) ? b.categories : []).slice(0, 20).map((c: any) => ({
    id: id(c?.id, 'c'),
    title: clean(c?.title, 80),
    questions: (Array.isArray(c?.questions) ? c.questions : []).slice(0, 60).map((q: any) => {
      const question = clean(q?.question, 200)
      const answer = clean(q?.answer, 3000)
      const all = `${question}\n${answer}`
      if (/<[a-z!/]/i.test(all)) throw new Error(`"${question || 'A question'}" cannot contain HTML. Use plain text and [label](link) links.`)
      for (const l of answer.matchAll(LINK)) if (!isSafeHref(l[2])) throw new Error(`The link "${l[2]}" in "${question}" must be a page on this site (like #shop) or a full https:// address.`)
      const approved = q?.approved === true
      if (approved && (!question || !answer)) throw new Error(`"${question || 'A question'}" needs a question and an answer before it can be approved.`)
      if (approved && hasPlaceholder(all)) throw new Error(`"${question}" still has a placeholder in [BRACKETS]. Replace it before approving.`)
      return {
        id: id(q?.id, 'q'),
        question,
        answer,
        keywords: (Array.isArray(q?.keywords) ? q.keywords : String(q?.keywords ?? '').split(','))
          .map((k: unknown) => clean(k, 40).toLowerCase())
          .filter(Boolean)
          .slice(0, 20),
        approved,
        needsConfirmation: approved ? false : q?.needsConfirmation === true,
        ownerNote: clean(q?.ownerNote, 600),
      }
    }),
  }))
  return {
    heading: clean(b.heading, 100),
    intro: clean(b.intro, 300),
    contact: { email, hours: clean(contact.hours, 120), timezone: clean(contact.timezone, 60), responseTime: clean(contact.responseTime, 160) },
    categories,
  }
}

/** The snapshot stored on Publish: approved questions only, no admin fields, unfinished contact details removed. */
export function publishedSnapshot(c: FaqContent): PublicFaq {
  const contact: Partial<FaqContact> = {}
  for (const [k, v] of Object.entries(c.contact) as Array<[keyof FaqContact, string]>) if (v && !hasPlaceholder(v)) contact[k] = v
  return {
    heading: c.heading,
    intro: c.intro,
    contact,
    categories: c.categories
      .map((cat) => ({ id: cat.id, title: cat.title, questions: cat.questions.filter((q) => q.approved && !hasPlaceholder(`${q.question}\n${q.answer}`)).map(({ id, question, answer, keywords }) => ({ id, question, answer, keywords })) }))
      .filter((cat) => cat.title && cat.questions.length),
  }
}

/** Removes paragraphs whose condition is not met right now (for example the quiz sentence when no quiz is published). */
export function applyConditions(f: PublicFaq, live: Record<Condition, boolean>): PublicFaq {
  return {
    ...f,
    categories: f.categories
      .map((cat) => ({
        ...cat,
        questions: cat.questions
          .map((q) => ({
            ...q,
            answer: q.answer
              .split(/\n{2,}/)
              .filter((p) => {
                const m = p.trim().match(CONDITION)
                return !m || live[m[1] as Condition]
              })
              .join('\n\n'),
          }))
          .filter((q) => q.answer.trim()),
      }))
      .filter((cat) => cat.questions.length),
  }
}

/* ---------- Starter drafts for the owner to review ---------- */

const q = (id: string, question: string, answer: string, opts: Partial<FaqQuestion> = {}): FaqQuestion => ({ id, question, answer, keywords: [], approved: false, needsConfirmation: false, ownerNote: '', ...opts })

export const starterFaq = (): FaqContent => ({
  heading: 'A little help, a lot of nurse love',
  intro: 'Questions about your goodies? Let’s get you sorted.',
  contact: { email: '[SUPPORT EMAIL]', hours: '[DAYS AND HOURS]', timezone: '[TIMEZONE]', responseTime: '[APPROVED RESPONSE TIME]' },
  categories: [
    {
      id: 'choosing',
      title: 'Choosing your resources',
      questions: [
        q('binder-inserts', 'What are binder inserts? Is a physical binder included?', 'Binder inserts are printable pages you add to your own binder. Nurse Love Company sells the inserts only; a physical binder is not included. Check each product listing to see exactly what’s included.', { keywords: ['binder', 'inserts', 'printable', 'included'] }),
        q('nurse-vs-np', 'What’s the difference between Nurse Binder Inserts and NP Binder Inserts?', 'Our Nurse Binder Inserts and NP Binder Inserts are organized into separate collections so you can find resources for your nursing journey. Each listing explains its intended audience, topics, and contents to help you choose.', { keywords: ['nurse practitioner', 'np', 'collection', 'difference'] }),
        q('students-or-nurses', 'Are these resources for students or practicing nurses?', 'Our resources support nursing students, nurse practitioner students, and nurses at different stages of their journey. Check the intended audience on each product page to make sure the resource fits your needs.', { keywords: ['student', 'audience', 'school'] }),
        q(
          'choose-right',
          'How do I choose the right resources for me?',
          'Browse the [Nurse Binder Inserts](#nurse-binder-inserts) or [NP Binder Inserts](#np-binder-inserts) collection and check each product’s description and What’s included section.\n\n{{if quiz}} You can also use [Find my resources](#find-my-resources) for suggestions based on your answers.',
          { keywords: ['quiz', 'recommend', 'choose', 'suggestion'], ownerNote: 'The "Find my resources" sentence only shows while a resource quiz is published, and opens the quiz panel.' },
        ),
        q('peek-inside', 'Can I peek inside before purchasing?', 'Yes! When a product has an approved sample, select “Peek inside” to view selected watermarked pages or details. Samples show a portion of the resource, rather than the complete paid file.', { keywords: ['sample', 'preview', 'pages'] }),
      ],
    },
    {
      id: 'downloads',
      title: 'Digital downloads',
      questions: [
        q('find-files', 'Where do I find my files after purchasing?', 'Sign in to the account used for your purchase and open [My Downloads](#account-downloads). Your eligible digital purchases will appear there once payment is confirmed. Save your downloaded files somewhere you can easily find them again.', { keywords: ['download', 'files', 'pdf', 'account'] }),
        q('how-many', 'How many times can I download each resource?', 'Each digital purchase includes one download. Before starting, choose a device where you can safely save the file. Once saved, keep a backup for your personal use so you can find it again.\n\nIf an updated version is released, eligible buyers receive one available download of the latest version. An unused older download is replaced rather than added to it.', { keywords: ['download limit', 'once', 'again', 'redownload'] }),
        q('download-failed', 'What if my download fails or I lose my saved file?', 'Check your device’s Downloads folder and any location where you normally save files. If you still need help, contact us with your order number and a description of what happened.\n\nReplacement downloads are reviewed individually and are not automatically guaranteed. Please don’t include passwords, payment-card details, or patient information in your message.', { keywords: ['lost', 'failed', 'broken', 'replacement'] }),
        q(
          'updates',
          'What happens when a resource I purchased is updated?',
          'Your available download will provide the latest released version. If you previously downloaded an older version, you’ll receive an email when a new version is available, with a link to [My Downloads](#account-downloads).\n\nYou’ll have one download of the latest version available. If you never downloaded the resource, your existing unused download will provide the latest version, and you won’t receive an update email.',
          { keywords: ['update', 'new version', 'email'], ownerNote: 'Automatic update releases and emails are built and tested, but update emails are only sent once Resend is connected. Approve after connecting Resend and confirming one real update.' },
        ),
        q('tablet-or-print', 'Can I use the resources on a tablet, or do I need to print them?', 'Usage varies by resource. Check the product page for its file format and confirmed digital compatibility before purchasing. Some resources may be suitable for printing, digital use, or both.', { keywords: ['tablet', 'ipad', 'digital', 'print'] }),
        q('app', 'Do I need a particular app?', 'Check the individual listing for confirmed app requirements or compatibility. Don’t assume every file is editable, fillable, or compatible with every note-taking app. If you’re unsure about a specific product, contact us before purchasing.', { keywords: ['goodnotes', 'notability', 'app', 'fillable'] }),
        q('paper-size', 'What paper size and printer settings should I use?', 'Use the page dimensions and printing instructions listed for your resource. Check your printer’s preview before printing, and try one test page before printing the complete file. Binder and hole-punch requirements depend on the supplies you choose.', { keywords: ['paper', 'printer', 'letter', 'a4', 'hole punch'] }),
        q(
          'assemble',
          'How do I put my binder together?',
          'Visit [Tutorials](#tutorials) for available videos showing how to print, organize, and assemble your inserts. You’ll need to provide your own physical binder and any other supplies.',
          { keywords: ['assemble', 'tutorial', 'video', 'organize'], ownerNote: 'Approve only once relevant tutorials are published.' },
        ),
        q(
          'sharing',
          'Can I share the files with classmates or coworkers?',
          'Your purchase is for your own personal use. Please don’t share, redistribute, resell, or upload the files for others to access. Classmates and coworkers can purchase their own copies.',
          { keywords: ['share', 'license', 'classmates', 'group'], needsConfirmation: true, ownerNote: 'Suggested policy. Do not mention classroom or group licensing unless you offer it.' },
        ),
      ],
    },
    {
      id: 'shipping',
      title: 'Apparel, accessories & shipping',
      questions: [
        q('shirt-size', 'How do I choose my shirt size?', 'Check the size chart and fit notes on the individual product page before ordering. Measurements and fit can vary by style. Comparing the chart with a shirt you already own can help you choose.', { keywords: ['size', 'fit', 'shirt', 'tee', 'chart'], ownerNote: 'Add accurate size charts to apparel listings before approving.' }),
        q('arrival-time', 'How long will my order take to arrive?', 'Production and delivery times vary by product and destination. Please check the estimated timing shown on the product page or at checkout. Allow time for both production and shipping; an estimate is not a guaranteed arrival date.', { keywords: ['delivery time', 'how long', 'arrive', 'production'], needsConfirmation: true }),
        q('where-ship', 'Where do you ship?', 'We currently ship to [APPROVED DESTINATIONS]. Available shipping options depend on your delivery address and the items in your cart.', { keywords: ['international', 'countries', 'destination'], needsConfirmation: true }),
        q('shipping-cost', 'How much does shipping cost?', 'Shipping charges for physical products are shown at checkout before payment. Costs depend on the items, destination, and available shipping options. Digital downloads do not require shipping.', { keywords: ['shipping cost', 'price', 'checkout'], ownerNote: 'Approve once checkout shipping is configured and checked.' }),
        q('tracking', 'Where can I track my order?', 'When tracking is available, you can find it in your account’s [order details](#account-orders) and any shipment notification we send. Tracking may take time to update after a shipping label is created.', { keywords: ['tracking', 'track', 'where is my order'], ownerNote: 'Approve once a real shipment shows tracking in the account and the shipping email has been checked (needs Resend).' }),
        q('separate-packages', 'Why did my items arrive in separate packages?', 'Some physical items may ship separately. If your order has multiple shipments, check the tracking details for each package. Digital items are accessed through My Downloads and won’t arrive in a physical package.', { keywords: ['split', 'separate', 'multiple packages'] }),
        q('change-cancel', 'Can I change my address or cancel an order?', 'Contact us as soon as possible with your order number and requested change. Once production or shipping begins, changes or cancellation may no longer be possible. We’ll check the order status and explain the available options.', { keywords: ['cancel', 'address', 'change order'], needsConfirmation: true, ownerNote: 'Do not promise a cancellation window unless confirmed with Printful.' }),
        q('damaged-missing', 'What if my item arrives damaged, incorrect, or never arrives?', 'Contact us at [SUPPORT EMAIL] within [APPROVED REPORTING PERIOD]. Include your order number and a description of the issue. For damaged or incorrect items, we may request clear photos of the item and packaging so we can investigate.\n\nFor a missing package, check its tracking and confirm your shipping address, then contact us for help.', { keywords: ['damaged', 'wrong item', 'missing', 'lost package'], needsConfirmation: true }),
      ],
    },
    {
      id: 'orders',
      title: 'Orders & support',
      questions: [
        q('refund-policy', 'What is your return, exchange, and refund policy?', 'Please review our Returns & Refunds policy before purchasing. Digital products and physical products may have different requirements. If something goes wrong with your order, contact us with your order number so we can review it.', { keywords: ['return', 'refund', 'exchange', 'policy'], needsConfirmation: true, ownerNote: 'Add a link to the approved policy once it is published. Do not invent eligibility, exclusions or deadlines.' }),
        q('order-history', 'Where can I find my order history and receipts?', 'Sign in to your account to view previous purchases and available receipts in [My orders](#account-orders). Use the same account associated with your order. If a purchase appears to be missing, contact us with your order number.', { keywords: ['receipt', 'order history', 'invoice'] }),
        q('discount-code', 'How do I use a discount code?', 'Enter your code in the discount field at checkout before paying. Check the promotion’s terms for eligible products, minimum purchases, and expiration dates. If a code doesn’t work, make sure it’s entered correctly and that your order meets its requirements.', { keywords: ['coupon', 'promo', 'discount', 'code'], ownerNote: 'Approve once Stripe checkout is connected and a test code works there.' }),
        q('freebie-corner', 'How do I access the Freebie Corner?', 'Select [Freebie Corner](#freebie-corner) from the website navigation to explore available free resources. Each resource will explain how to access it and any applicable requirements.', { keywords: ['free', 'freebie', 'printable'] }),
        q('contact-reply', 'How can I contact you, and when should I expect a reply?', 'Email us at [SUPPORT EMAIL]. Our support hours are [DAYS, HOURS, AND TIMEZONE], and we aim to respond within [APPROVED RESPONSE TIME].\n\nFor order questions, include your order number. Please don’t send passwords, payment-card details, or patient information.', { keywords: ['contact', 'email', 'support', 'reply'], needsConfirmation: true }),
        q('not-a-substitute', 'Do these resources replace my course materials or workplace guidance?', 'These resources are educational study and organization tools. Use them alongside your course materials, current professional references, and applicable workplace policies. They are not a substitute for clinical judgment, patient-specific assessment, or guidance from your instructors or clinical supervisors.', { keywords: ['clinical', 'disclaimer', 'course', 'workplace'], needsConfirmation: true, ownerNote: 'Please review this wording before approving.' }),
      ],
    },
  ],
})
