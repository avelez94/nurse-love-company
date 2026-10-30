/*
  Our Story ("Meet the nurse behind the love"). The owner edits a draft;
  visitors see only what she explicitly published. Nothing is invented:
  every field is her own words, and empty fields are simply left out.
*/
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { str, uuid } from '../lib/validate.js'
import { PUBLIC_WHERE } from './catalog.js'
import { linkField } from './marketing.js'
import { isPlaceholderUrl, showNurseKin, STORY_STARTERS, type StoryFeature } from '../../shared/story.js'
import { normalizePolicy, POLICY_META, policyProblems, publishedSnapshot as policySnapshot, starterPolicy, type PolicyDraft, type PolicyKey, type PublishedPolicy } from '../../shared/policies.js'
import { getSettings } from './settings.js'
import { integrationStatus } from '../env.js'
import { applyConditions, normalizeFaq, publishedSnapshot, starterFaq, type FaqContent, type PublicFaq } from '../../shared/faq.js'

export const STORY_UPLOAD_TARGET = '00000000-0000-0000-0000-0000005707e5'

export interface Story {
  founderName: string
  professionalTitle: string
  credentials: string
  portraitKey: string | null
  portraitType: string | null
  portraitAlt: string
  greeting: string
  /** The short founder introduction. */
  introduction: string
  storeHeading: string
  storeIntro: string
  features: StoryFeature[]
  shopLabel: string
  shopLink: string
  closingNote: string
  signature: string
  favoritesEnabled: boolean
  favoriteIds: string[]
  /** The longer story sections, optional and kept even when hidden. */
  showFullStory: boolean
  background: string
  whyCreated: string
  process: string
  whoWeSupport: string
  /** The earlier closing message; shown only while the closing message is empty. */
  closing: string
  nurseKinText: string
  nurseKinUrl: string
  homeExcerpt: string
}

// Content published before the redesign has none of the newer fields, so they read as empty
// (and its longer sections stay visible, as they were).
const blank: Story = {
  founderName: '', professionalTitle: '', credentials: '', portraitKey: null, portraitType: null, portraitAlt: '', greeting: '', introduction: '',
  storeHeading: '', storeIntro: '', features: [], shopLabel: '', shopLink: '', closingNote: '', signature: '', favoritesEnabled: false, favoriteIds: [],
  showFullStory: true, background: '', whyCreated: '', process: '', whoWeSupport: '', closing: '', nurseKinText: '', nurseKinUrl: '', homeExcerpt: '',
}

const STARTER_KEYS = ['greeting', 'storeHeading', 'storeIntro', 'features', 'shopLabel', 'shopLink', 'closingNote', 'signature'] as const

/** The draft as the editor sees it: starter wording only where a field was never saved. */
function draftOf(saved: Partial<Story>): Story {
  const starters: Partial<Story> = {}
  for (const k of STARTER_KEYS) if (!(k in saved)) Object.assign(starters, { [k]: structuredClone(STORY_STARTERS[k]) })
  return { ...blank, ...starters, ...saved }
}

const text = (v: unknown, field: string, max: number) =>
  str(v, field, { optional: true, max })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

async function row() {
  await q(`insert into site_content (key) values ('our_story') on conflict (key) do nothing`)
  return (await one<{ draft: Partial<Story>; published: Partial<Story> | null; published_at: string | null; updated_at: string }>(`select draft, published, published_at, updated_at from site_content where key = 'our_story'`))!
}

const stable = (s: Story) => JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k as keyof Story]]))

export function storyProblems(s: Story) {
  const p: string[] = []
  if (!s.founderName) p.push('Add the founder name.')
  if (!s.introduction) p.push('Add the founder introduction.')
  if (!s.homeExcerpt) p.push('Add the short home page introduction.')
  if (!s.portraitKey) p.push('Add a portrait.')
  if (s.portraitKey && !s.portraitAlt) p.push('Describe the portrait (alt text).')
  if (s.nurseKinText && !s.nurseKinUrl) p.push('Add the Nurse Kin link, or remove the Nurse Kin text.')
  if (s.nurseKinUrl && isPlaceholderUrl(s.nurseKinUrl)) p.push('Replace the placeholder Nurse Kin link with the real address, or clear the Nurse Kin link and text.')
  return p
}

export async function adminStory() {
  const r = await row()
  const draft = draftOf(r.draft)
  const published = r.published ? { ...blank, ...r.published } : null
  return { draft, published, publishedAt: r.published_at, unpublishedChanges: !published || stable(draft) !== stable(published), problems: storyProblems(draft), uploadTarget: STORY_UPLOAD_TARGET }
}

function features(v: unknown): StoryFeature[] {
  if (!Array.isArray(v)) throw badRequest('Feature cards must be a list.')
  if (v.length > 3) throw badRequest('Keep to three feature cards.')
  return v.map((f, i) => ({ heading: text(f?.heading, `Feature card ${i + 1} heading`, 60), text: text(f?.text, `Feature card ${i + 1} description`, 200) }))
}

async function favoriteIds(v: unknown) {
  if (!Array.isArray(v)) throw badRequest('Favorites must be a list.')
  const ids = [...new Set(v.map((x) => uuid(x, 'favorite product')))]
  if (ids.length > 3) throw badRequest('Choose up to three favorites.')
  const found = await q<{ id: string }>(`select id from products where id = any($1) and archived_at is null`, [ids])
  if (found.length !== ids.length) throw badRequest('One of the chosen favorites is no longer in the store.')
  return ids
}

/** Saves the fields sent; a field left out of the request keeps its saved value. */
export async function saveStoryDraft(actor: SessionUser, b: Record<string, unknown>) {
  const r = await row()
  const current = draftOf(r.draft)
  const has = (k: keyof Story) => k in b
  const t = (k: keyof Story, label: string, max: number) => (has(k) ? text(b[k], label, max) : (current[k] as string))
  const draft: Story = {
    ...current,
    founderName: t('founderName', 'Founder name', 80),
    professionalTitle: t('professionalTitle', 'Professional title', 120),
    credentials: t('credentials', 'Credentials', 200),
    portraitAlt: t('portraitAlt', 'Portrait description', 200),
    greeting: t('greeting', 'Speech bubble greeting', 140),
    introduction: t('introduction', 'Founder introduction', 1500),
    storeHeading: t('storeHeading', 'Store heading', 120),
    storeIntro: t('storeIntro', 'Store introduction', 1500),
    features: has('features') ? features(b.features) : current.features,
    shopLabel: t('shopLabel', 'Shop button label', 40),
    shopLink: has('shopLink') ? linkField(b.shopLink, 'Shop button destination') : current.shopLink,
    closingNote: t('closingNote', 'Closing message', 600),
    signature: t('signature', 'Signature', 80),
    favoritesEnabled: has('favoritesEnabled') ? b.favoritesEnabled === true : current.favoritesEnabled,
    favoriteIds: has('favoriteIds') ? await favoriteIds(b.favoriteIds) : current.favoriteIds,
    showFullStory: has('showFullStory') ? b.showFullStory === true : current.showFullStory,
    background: t('background', 'Nursing background', 3000),
    whyCreated: t('whyCreated', 'Why she created Nurse Love Company', 3000),
    process: t('process', 'How resources are made and reviewed', 3000),
    whoWeSupport: t('whoWeSupport', 'Who she hopes to support', 2000),
    closing: t('closing', 'Earlier closing message', 1500),
    nurseKinText: t('nurseKinText', 'Nurse Kin description', 600),
    nurseKinUrl: has('nurseKinUrl') ? linkField(b.nurseKinUrl, 'Nurse Kin link', { httpsOnly: true }) : current.nurseKinUrl,
    homeExcerpt: t('homeExcerpt', 'Home page introduction', 400),
  }
  if (draft.homeExcerpt.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length > 4) throw badRequest('Keep the home page introduction to two or three sentences.')
  await q(`update site_content set draft = $1, updated_by = $2, updated_at = now() where key = 'our_story'`, [JSON.stringify(draft), actor.email])
  return adminStory()
}

export async function setStoryPortrait(key: string, type: string) {
  const r = await row()
  const draft = { ...r.draft, portraitKey: key, portraitType: type }
  await q(`update site_content set draft = $1, updated_at = now() where key = 'our_story'`, [JSON.stringify(draft)])
}

export async function publishStory(actor: SessionUser, action: 'publish' | 'unpublish', ip?: string) {
  const r = await row()
  const draft = draftOf(r.draft)
  if (action === 'publish') {
    const problems = storyProblems(draft)
    if (problems.length) throw badRequest(`Our Story is not ready to publish. ${problems.join(' ')}`)
    // What she previewed is what goes live, starter wording included.
    await q(`update site_content set draft = $1, published = $1, published_at = now(), updated_by = $2, updated_at = now() where key = 'our_story'`, [JSON.stringify(draft), actor.email])
  } else {
    await q(`update site_content set published = null, updated_by = $1, updated_at = now() where key = 'our_story'`, [actor.email])
  }
  await audit({ actor, action: `content.our_story_${action}`, entityType: 'content', entityId: 'our_story', summary: action === 'publish' ? 'Published Our Story' : 'Unpublished Our Story', ip })
  return adminStory()
}

/** What visitors may see. Null until the owner publishes. */
export async function publicStory() {
  const r = await row()
  if (!r.published) return null
  const { portraitKey, portraitType, favoriteIds, favoritesEnabled, ...rest } = { ...blank, ...r.published }
  // Favorites that are no longer for sale simply drop out, keeping her order.
  const live = favoritesEnabled && favoriteIds.length ? (await q<{ id: string }>(`select p.id from products p where p.id = any($1) and ${PUBLIC_WHERE}`, [favoriteIds])).map((x) => x.id) : []
  return {
    ...rest,
    ...(showNurseKin(rest) ? {} : { nurseKinText: '', nurseKinUrl: '' }),
    favoriteIds: favoriteIds.filter((id) => live.includes(id)),
    portraitUrl: portraitKey ? `/api/content/our-story/portrait?v=${encodeURIComponent(r.published_at ?? '')}` : null,
  }
}

export async function storyPortrait(which: 'published' | 'draft') {
  const r = await row()
  const s = which === 'published' ? r.published : r.draft
  if (!s?.portraitKey) throw notFound('Portrait')
  return { key: s.portraitKey, type: s.portraitType ?? 'image/jpeg' }
}

/* ---------- Help & FAQs ---------- */

/*
  The Help page. The owner edits a draft; Publish stores a snapshot with only
  the questions she approved (no owner notes, no unfinished contact details).
  Edits after that stay in the draft until she publishes again. The first
  time the editor opens, the starter answers load as unapproved drafts.
*/

async function helpRow() {
  await q(`insert into site_content (key, draft) values ('help_faq', $1) on conflict (key) do nothing`, [JSON.stringify(starterFaq())])
  return (await one<{ draft: FaqContent; published: PublicFaq | null; published_at: string | null; updated_at: string; updated_by: string | null }>(
    `select draft, published, published_at, updated_at, updated_by from site_content where key = 'help_faq'`,
  ))!
}

function faqCounts(c: FaqContent) {
  const all = c.categories.flatMap((cat) => cat.questions)
  return { questions: all.length, approved: all.filter((x) => x.approved).length, needsConfirmation: all.filter((x) => x.needsConfirmation).length }
}

export async function adminHelp() {
  const r = await helpRow()
  const draft = normalizeFaq(r.draft)
  const snapshot = publishedSnapshot(draft)
  return {
    draft,
    published: r.published,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    counts: faqCounts(draft),
    unpublishedChanges: JSON.stringify(snapshot) !== JSON.stringify(r.published),
  }
}

function parseFaq(b: unknown) {
  try {
    return normalizeFaq(b)
  } catch (err) {
    throw badRequest((err as Error).message)
  }
}

export async function saveHelpDraft(actor: SessionUser, b: unknown) {
  await helpRow()
  const draft = parseFaq(b)
  await q(`update site_content set draft = $1, updated_by = $2, updated_at = now() where key = 'help_faq'`, [JSON.stringify(draft), actor.email])
  return adminHelp()
}

export async function publishHelp(actor: SessionUser, action: 'publish' | 'unpublish', ip?: string) {
  const r = await helpRow()
  const draft = parseFaq(r.draft)
  if (action === 'publish') {
    if (!draft.heading) throw badRequest('Add the page heading before publishing.')
    const snapshot = publishedSnapshot(draft)
    await q(`update site_content set published = $1, published_at = now(), updated_by = $2, updated_at = now() where key = 'help_faq'`, [JSON.stringify(snapshot), actor.email])
    const n = snapshot.categories.reduce((a, c) => a + c.questions.length, 0)
    await audit({ actor, action: 'content.help_publish', entityType: 'content', entityId: 'help_faq', summary: `Published Help & FAQs with ${n} approved question${n === 1 ? '' : 's'}`, ip })
  } else {
    await q(`update site_content set published = null, updated_by = $1, updated_at = now() where key = 'help_faq'`, [actor.email])
    await audit({ actor, action: 'content.help_unpublish', entityType: 'content', entityId: 'help_faq', summary: 'Unpublished Help & FAQs', ip })
  }
  return adminHelp()
}

/** What visitors see: the published snapshot only, with conditional sentences resolved now. Null until published. */
export async function publicHelp(): Promise<PublicFaq | null> {
  const r = await one<{ published: PublicFaq | null }>(`select published from site_content where key = 'help_faq'`)
  if (!r?.published) return null
  const live = await one<{ quiz: boolean; tutorials: boolean }>(
    `select exists (select 1 from quizzes where status = 'published') as quiz, exists (select 1 from tutorials where status = 'published') as tutorials`,
  )
  return applyConditions(r.published, { quiz: Boolean(live?.quiz), tutorials: Boolean(live?.tutorials) })
}

/* ---------- Policies (Terms & Conditions, Privacy Policy) ---------- */

/*
  Each policy is a draft of sections the owner reviews one by one. Publish
  stores a dated snapshot, and only when every section is reviewed and no
  placeholder is left. Text saved earlier in Settings, Policies is kept: it
  becomes the first draft instead of the starter wording.
*/

async function policyRow(key: PolicyKey) {
  const existing = await one<{ draft: PolicyDraft }>(`select draft from site_content where key = $1`, [`policy_${key}`])
  if (!existing) {
    const earlier = (await getSettings()).policies[key].trim()
    const draft: PolicyDraft = earlier
      ? { intro: '', sections: [{ id: 'earlier', heading: POLICY_META[key].title, body: earlier, reviewed: false, ownerNote: 'Your earlier text from Settings, kept as it was. Split it into sections if you like.' }] }
      : starterPolicy(key)
    await q(`insert into site_content (key, draft) values ($1, $2) on conflict (key) do nothing`, [`policy_${key}`, JSON.stringify(draft)])
  }
  return (await one<{ draft: PolicyDraft; published: PublishedPolicy | null; published_at: string | null; updated_at: string; updated_by: string | null }>(
    `select draft, published, published_at, updated_at, updated_by from site_content where key = $1`,
    [`policy_${key}`],
  ))!
}

function parsePolicy(b: unknown) {
  try {
    return normalizePolicy(b)
  } catch (err) {
    throw badRequest((err as Error).message)
  }
}

export async function adminPolicy(key: PolicyKey) {
  const r = await policyRow(key)
  const draft = normalizePolicy(r.draft)
  const current = r.published ? policySnapshot(draft, new Date(r.published.lastUpdated)) : null
  return {
    key,
    title: POLICY_META[key].title,
    draft,
    published: r.published,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    problems: policyProblems(draft),
    unpublishedChanges: !r.published || JSON.stringify(current) !== JSON.stringify(r.published),
    services: integrationStatus(),
  }
}

export async function savePolicyDraft(actor: SessionUser, key: PolicyKey, b: unknown) {
  await policyRow(key)
  const draft = parsePolicy(b)
  await q(`update site_content set draft = $1, updated_by = $2, updated_at = now() where key = $3`, [JSON.stringify(draft), actor.email, `policy_${key}`])
  return adminPolicy(key)
}

export async function publishPolicy(actor: SessionUser, key: PolicyKey, action: 'publish' | 'unpublish', ip?: string) {
  const r = await policyRow(key)
  const title = POLICY_META[key].title
  if (action === 'publish') {
    const draft = parsePolicy(r.draft)
    const problems = policyProblems(draft)
    if (problems.length) throw badRequest(`${title} is not ready to publish. ${problems.join(' ')}`)
    const snapshot = policySnapshot(draft, new Date())
    await q(`update site_content set published = $1, published_at = now(), updated_by = $2, updated_at = now() where key = $3`, [JSON.stringify(snapshot), actor.email, `policy_${key}`])
  } else {
    await q(`update site_content set published = null, updated_by = $1, updated_at = now() where key = $2`, [actor.email, `policy_${key}`])
  }
  await audit({ actor, action: `content.policy_${action}`, entityType: 'content', entityId: `policy_${key}`, summary: `${action === 'publish' ? 'Published' : 'Unpublished'} ${title}`, ip })
  return adminPolicy(key)
}

/** The published policy only. Null until the owner publishes it. */
export async function publicPolicy(key: PolicyKey): Promise<PublishedPolicy | null> {
  const r = await one<{ published: PublishedPolicy | null }>(`select published from site_content where key = $1`, [`policy_${key}`])
  return r?.published ?? null
}
