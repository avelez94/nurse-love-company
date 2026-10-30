/*
  Branded email templates. The owner can edit the subject, heading, body text
  and button label of each template in the admin (stored in email_templates).
  The layout and all variable values are rendered here with HTML escaping, so
  template edits can never inject markup.
*/

export type EmailType =
  | 'order_confirmation'
  | 'digital_available'
  | 'shipping_confirmation'
  | 'product_update'
  | 'password_reset'
  | 'download_reminder'
  | 'review_request_digital'
  | 'review_request_physical'

/** Automation emails are edited under Marketing, Email Automations rather than the general template list. */
export const AUTOMATION_TYPES: EmailType[] = ['download_reminder', 'review_request_digital', 'review_request_physical']

export interface TemplateText {
  subject: string
  heading: string
  body: string
  button_label: string
}

export const templateInfo: Record<EmailType, { title: string; placeholders: string[]; buttonPath: string }> = {
  order_confirmation: { title: 'Order confirmation', placeholders: ['name', 'order_number', 'order_total'], buttonPath: 'order' },
  digital_available: { title: 'Digital purchase available', placeholders: ['name', 'order_number', 'product_list'], buttonPath: 'downloads' },
  shipping_confirmation: { title: 'Shipping confirmation', placeholders: ['name', 'order_number', 'carrier', 'tracking_number'], buttonPath: 'order' },
  product_update: { title: 'Product update available', placeholders: ['name', 'product_title', 'version', 'release_date', 'update_notes'], buttonPath: 'downloads' },
  password_reset: { title: 'Password reset', placeholders: ['name'], buttonPath: 'reset' },
  download_reminder: { title: 'Download reminder', placeholders: ['name', 'order_number'], buttonPath: 'downloads' },
  review_request_digital: { title: 'Review request (digital)', placeholders: ['name', 'order_number'], buttonPath: 'none' },
  review_request_physical: { title: 'Review request (physical)', placeholders: ['name', 'order_number'], buttonPath: 'none' },
}

export const defaultTemplates: Record<EmailType, TemplateText> = {
  order_confirmation: {
    subject: 'Your Nurse Love Company order {{order_number}}',
    heading: 'Thank you for your order!',
    body: 'Hi {{name}},\n\nWe received your order {{order_number}}. Your total was {{order_total}}.\n\nYou can view your order details and receipt in your account at any time.',
    button_label: 'View your order',
  },
  digital_available: {
    subject: 'Your digital download is ready',
    heading: 'Your download is ready',
    body: 'Hi {{name}},\n\nYour digital purchase from order {{order_number}} is ready in your account: {{product_list}}.\n\nEach purchase includes one download. Sign in to your account to download your file, and save it somewhere you can find it again.',
    button_label: 'Go to My Downloads',
  },
  shipping_confirmation: {
    subject: 'Your order {{order_number}} has shipped',
    heading: 'Your order is on its way',
    body: 'Hi {{name}},\n\nGood news! Items from order {{order_number}} have shipped with {{carrier}}. Your tracking number is {{tracking_number}}.',
    button_label: 'Track your order',
  },
  product_update: {
    subject: 'An updated version of {{product_title}} is ready 💕',
    heading: 'Your update is ready',
    body: 'Hi {{name}},\n\nThere is an updated version of {{product_title}} (version {{version}}, updated {{release_date}}).\n\n{{update_notes}}\n\nOne download of the updated version is ready for you in My downloads. Save the new file somewhere you can easily find it again.',
    button_label: 'My downloads',
  },
  password_reset: {
    subject: 'Reset your Nurse Love Company password',
    heading: 'Reset your password',
    body: 'Hi {{name}},\n\nWe received a request to reset your password. This link expires in one hour. If you did not ask for this, you can ignore this email.',
    button_label: 'Choose a new password',
  },
  download_reminder: {
    subject: 'Your nursing goodies are waiting 💕',
    heading: 'Your digital goodies are ready',
    body: 'Hi {{name}},\n\nA little reminder that your digital goodies are ready whenever you are. Head to your account to download them, and save your files somewhere you can easily find them again.',
    button_label: 'My downloads',
  },
  review_request_digital: {
    subject: 'How are your Nurse Love Company goodies working for you?',
    heading: 'We would love your honest review',
    body: 'Hi {{name}},\n\nThank you again for your order {{order_number}}. When you have a moment, we would love to hear what you honestly think. Praise, suggestions and things that did not work for you are all welcome, and every review helps other nurses choose what is right for them.',
    button_label: 'Leave a review',
  },
  review_request_physical: {
    subject: 'How are you liking your Nurse Love Company order?',
    heading: 'We would love your honest review',
    body: 'Hi {{name}},\n\nWe hope your order {{order_number}} arrived safely. When you have a moment, we would love to hear what you honestly think. Praise, suggestions and things that did not work for you are all welcome, and every review helps other nurses choose what is right for them.',
    button_label: 'Leave a review',
  },
}

const LIMITS = { subject: 160, heading: 160, body: 4000, button_label: 60 }

/** Validates owner edits: plain text only, known placeholders only, sensible lengths. */
export function validateTemplate(type: EmailType, t: TemplateText): string[] {
  const errors: string[] = []
  const allowed = new Set(templateInfo[type].placeholders)
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const v = t[key] ?? ''
    if (typeof v !== 'string') errors.push(`${key} must be text`)
    else if (v.length > LIMITS[key]) errors.push(`${key} is longer than ${LIMITS[key]} characters`)
    else if (key !== 'button_label' && v.trim() === '') errors.push(`${key} cannot be empty`)
    for (const m of String(v).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!allowed.has(m[1])) errors.push(`Unknown placeholder {{${m[1]}}} in ${key}`)
    if (/<[a-z!/]/i.test(String(v))) errors.push(`${key} cannot contain HTML`)
  }
  return errors
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '')
}

export interface RenderInput {
  template: TemplateText
  vars: Record<string, string>
  buttonUrl?: string
  /** Optional rows (for example order lines) drawn as a simple table. */
  rows?: Array<[string, string]>
  footerNote?: string
  /** Products shown with an optional thumbnail and, when url is set, their own button (template button label). */
  items?: Array<{ title: string; imageUrl?: string | null; url?: string }>
  /** Link to the email preference page, with the words shown for it. */
  preference?: { url: string; text: string }
}

export function renderEmail({ template, vars, buttonUrl, rows, footerNote, items, preference }: RenderInput) {
  const subject = fill(template.subject, vars).replace(/[\r\n]+/g, ' ').trim()
  const heading = fill(template.heading, vars)
  const paragraphs = fill(template.body, vars).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  const rowsHtml = rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${rows
        .map(
          ([a, b]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #EFD8DF;color:#680C35">${escapeHtml(a)}</td><td style="padding:8px 0;border-bottom:1px solid #EFD8DF;color:#680C35;text-align:right;white-space:nowrap">${escapeHtml(b)}</td></tr>`,
        )
        .join('')}</table>`
    : ''

  const itemButton = (url: string) =>
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:#D80853;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px;font-family:Georgia,serif;font-size:15px">${escapeHtml(template.button_label || 'Leave a review')}</a>`
  const itemsHtml = items?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${items
        .map(
          (it) =>
            `<tr><td style="padding:12px 0;border-bottom:1px solid #EFD8DF;width:72px;vertical-align:middle">${
              it.imageUrl
                ? `<img src="${escapeHtml(it.imageUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:10px;background:#FBDDE5">`
                : `<div style="width:64px;height:64px;border-radius:10px;background:#FBDDE5"></div>`
            }</td><td style="padding:12px 0 12px 12px;border-bottom:1px solid #EFD8DF;color:#680C35;font-size:16px;vertical-align:middle"><strong>${escapeHtml(it.title)}</strong>${
              it.url ? `<div style="margin-top:8px">${itemButton(it.url)}</div>` : ''
            }</td></tr>`,
        )
        .join('')}</table>`
    : ''

  const button =
    buttonUrl && template.button_label
      ? `<p style="margin:24px 0"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#D80853;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Georgia,serif;font-size:17px">${escapeHtml(template.button_label)}</a></p>`
      : ''

  const html = `<!doctype html><html><body style="margin:0;background:#FFFAF6;font-family:Helvetica,Arial,sans-serif;color:#680C35">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFAF6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #EFD8DF;border-radius:16px">
<tr><td style="background:#FFF0F2;border-radius:16px 16px 0 0;padding:16px 24px;font-family:Georgia,serif;font-size:22px;color:#680C35">Nurse Love Company</td></tr>
<tr><td style="padding:24px">
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:26px;margin:0 0 16px;color:#680C35">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.55;font-size:16px">${escapeHtml(p)}</p>`).join('\n')}
${itemsHtml}${rowsHtml}${button}
${footerNote ? `<p style="margin:16px 0 0;font-size:13px;color:#8A5A6C">${escapeHtml(footerNote)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #EFD8DF;font-size:12px;color:#8A5A6C">Made by a nurse, for nurses.${
    preference ? `<br><a href="${escapeHtml(preference.url)}" style="color:#8A5A6C">${escapeHtml(preference.text)}</a>` : ''
  }</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(items ?? []).flatMap((it) => [it.url ? `${it.title}: ${template.button_label || 'Leave a review'} ${it.url}` : `* ${it.title}`]),
    items?.length ? '' : null,
    ...(rows ?? []).map(([a, b]) => `${a}: ${b}`),
    rows?.length ? '' : null,
    buttonUrl && template.button_label ? `${template.button_label}: ${buttonUrl}` : null,
    footerNote ?? null,
    '',
    'Nurse Love Company. Made by a nurse, for nurses.',
    preference ? `${preference.text}: ${preference.url}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n')

  return { subject, html, text }
}
