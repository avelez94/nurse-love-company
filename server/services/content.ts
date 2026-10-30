/*
  Our Story ("Meet the nurse behind the love"). The owner edits a draft;
  visitors see only what she explicitly published. Nothing is invented:
  every field is her own words, and empty fields are simply left out.
*/
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { str } from '../lib/validate.js'
import { linkField } from './marketing.js'

export const STORY_UPLOAD_TARGET = '00000000-0000-0000-0000-0000005707e5'

export interface Story {
  founderName: string
  professionalTitle: string
  credentials: string
  portraitKey: string | null
  portraitType: string | null
  portraitAlt: string
  introduction: string
  background: string
  whyCreated: string
  process: string
  whoWeSupport: string
  closing: string
  nurseKinText: string
  nurseKinUrl: string
  homeExcerpt: string
}

const blank: Story = { founderName: '', professionalTitle: '', credentials: '', portraitKey: null, portraitType: null, portraitAlt: '', introduction: '', background: '', whyCreated: '', process: '', whoWeSupport: '', closing: '', nurseKinText: '', nurseKinUrl: '', homeExcerpt: '' }

const text = (v: unknown, field: string, max: number) =>
  str(v, field, { optional: true, max })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

async function row() {
  await q(`insert into site_content (key) values ('our_story') on conflict (key) do nothing`)
  return (await one<{ draft: Partial<Story>; published: Story | null; published_at: string | null; updated_at: string }>(`select draft, published, published_at, updated_at from site_content where key = 'our_story'`))!
}

export function storyProblems(s: Story) {
  const p: string[] = []
  if (!s.founderName) p.push('Add the founder name.')
  if (!s.introduction) p.push('Add the introduction.')
  if (!s.homeExcerpt) p.push('Add the short home page introduction.')
  if (!s.portraitKey) p.push('Add a portrait.')
  if (s.portraitKey && !s.portraitAlt) p.push('Describe the portrait (alt text).')
  if (s.nurseKinText && !s.nurseKinUrl) p.push('Add the Nurse Kin link, or remove the Nurse Kin text.')
  return p
}

export async function adminStory() {
  const r = await row()
  const draft = { ...blank, ...r.draft }
  return { draft, published: r.published, publishedAt: r.published_at, unpublishedChanges: JSON.stringify(draft) !== JSON.stringify(r.published), problems: storyProblems(draft), uploadTarget: STORY_UPLOAD_TARGET }
}

export async function saveStoryDraft(actor: SessionUser, b: Record<string, unknown>) {
  const r = await row()
  const current = { ...blank, ...r.draft }
  const draft: Story = {
    ...current,
    founderName: text(b.founderName, 'Founder name', 80),
    professionalTitle: text(b.professionalTitle, 'Professional title', 120),
    credentials: text(b.credentials, 'Credentials', 200),
    portraitAlt: text(b.portraitAlt, 'Portrait description', 200),
    introduction: text(b.introduction, 'Introduction', 1500),
    background: text(b.background, 'Nursing background', 3000),
    whyCreated: text(b.whyCreated, 'Why she created Nurse Love Company', 3000),
    process: text(b.process, 'How resources are made and reviewed', 3000),
    whoWeSupport: text(b.whoWeSupport, 'Who she hopes to support', 2000),
    closing: text(b.closing, 'Closing message', 1500),
    nurseKinText: text(b.nurseKinText, 'Nurse Kin description', 600),
    nurseKinUrl: linkField(b.nurseKinUrl, 'Nurse Kin link', { httpsOnly: true }),
    homeExcerpt: text(b.homeExcerpt, 'Home page introduction', 400),
  }
  if (draft.homeExcerpt.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length > 4) throw badRequest('Keep the home page introduction to two or three sentences.')
  await q(`update site_content set draft = $1, updated_by = $2, updated_at = now() where key = 'our_story'`, [JSON.stringify(draft), actor.email])
  return adminStory()
}

export async function setStoryPortrait(key: string, type: string) {
  const r = await row()
  const draft = { ...blank, ...r.draft, portraitKey: key, portraitType: type }
  await q(`update site_content set draft = $1, updated_at = now() where key = 'our_story'`, [JSON.stringify(draft)])
}

export async function publishStory(actor: SessionUser, action: 'publish' | 'unpublish', ip?: string) {
  const r = await row()
  const draft = { ...blank, ...r.draft }
  if (action === 'publish') {
    const problems = storyProblems(draft)
    if (problems.length) throw badRequest(`Our Story is not ready to publish. ${problems.join(' ')}`)
    await q(`update site_content set published = draft, published_at = now(), updated_by = $1, updated_at = now() where key = 'our_story'`, [actor.email])
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
  const { portraitKey, portraitType, ...rest } = { ...blank, ...r.published }
  return { ...rest, portraitUrl: portraitKey ? `/api/content/our-story/portrait?v=${encodeURIComponent(r.published_at ?? '')}` : null }
}

export async function storyPortrait(which: 'published' | 'draft') {
  const r = await row()
  const s = which === 'published' ? r.published : { ...blank, ...r.draft }
  if (!s?.portraitKey) throw notFound('Portrait')
  return { key: s.portraitKey, type: s.portraitType ?? 'image/jpeg' }
}
