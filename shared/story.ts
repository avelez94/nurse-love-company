/*
  Our Story fields shared by the server and the page. Starter wording fills
  only fields that were never saved, and only in the owner's draft: nothing
  reaches visitors until she publishes it.
*/

export interface StoryFeature {
  heading: string
  text: string
}

export const FEATURE_ICONS = ['page', 'heart', 'pen'] as const

export const STORY_STARTERS = {
  greeting: 'Hi, I’m Lada! Welcome to my little corner of nurse love. ♡',
  storeHeading: 'A little shop. A lot of nurse love.',
  storeIntro:
    'Nurse Love Company brings together study resources, Nurse Binder Inserts, NP Binder Inserts, and everyday favorites for your nursing journey.\n\n' +
    'Explore helpful pages for your own binder, find something new for your study routine, or pick out a little extra cute, from apparel to accessories and pens.\n\n' +
    'Made by a nurse, for nurses.',
  features: [
    { heading: 'For your studies', text: 'Explore resources for nursing and NP students.' },
    { heading: 'For your nursing journey', text: 'Find printable inserts to organize in your own binder.' },
    { heading: 'For a little extra cute', text: 'Discover apparel, accessories, and pens with personality.' },
  ] as StoryFeature[],
  shopLabel: 'Find your favorites',
  shopLink: '#shop',
  closingNote: 'Thanks for stopping by. We hope you find something helpful and something that makes you smile.',
  signature: 'With nurse love,\nLada ♡',
}

/** Example and local addresses are placeholders, never a real destination for visitors. */
export function isPlaceholderUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
    return /(^|\.)example\.(com|org|net)$/.test(host) || /\.(example|test|invalid|localhost)$/.test(host) || host === 'localhost'
  } catch {
    return true
  }
}

/** Nurse Kin shows only with an approved description and a real destination. */
export const showNurseKin = (s: { nurseKinText: string; nurseKinUrl: string }) => Boolean(s.nurseKinText.trim() && s.nurseKinUrl && !isPlaceholderUrl(s.nurseKinUrl))
