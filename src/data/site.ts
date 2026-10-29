/* Approved site copy. Keep wording here so it can be edited in one place. */

export const site = {
  name: 'Nurse Love Company',
  statement: 'Made by a nurse, for nurses.',
  existingSite: 'https://nurselovecompany.com',
  nav: [
    { label: 'Shop', route: 'shop' },
    { label: 'Freebie Corner', route: 'freebie-corner' },
    { label: 'Tutorials', route: 'tutorials' },
    { label: 'Our Story', route: 'our-story' },
  ],
  searchPlaceholder: 'Search planners, study tools...',
  hero: {
    line1: 'Your nursing life,',
    line2: 'beautifully organized.',
    copy: 'Study resources, printable inserts & everyday favorites for your nursing life.',
    primary: 'Shop resources',
    secondary: 'Find your essentials',
    label: 'Inserts only • Binder not included',
  },
  benefits: [
    { icon: 'download', title: 'Digital downloads', text: 'For your study resources.' },
    { icon: 'heart', title: 'Made for your nursing life', text: 'Thoughtful, practical, and cute.' },
    { icon: 'laptop', title: 'Print or use digitally', text: 'Check each resource for details.' },
  ],
  collectionsHeading: 'Two paths. Find your fit.',
  insertLabel: 'Digital download • Binder not included',
  insertButton: 'Explore inserts',
  extraHeading: 'A little extra cute',
  shipsLabel: 'Ships to you',
  extraCards: [
    { category: 'apparel', button: 'Shop apparel', image: 'tee' },
    { category: 'accessories', button: 'Shop accessories', image: 'earrings-drop' },
    { category: 'pens', button: 'Shop pens', image: 'pens-pair' },
  ],
  freebie: {
    heading: 'The Freebie Corner',
    tagline: 'A little nurse love, on us.',
    copy: 'Helpful, beautiful printables to support your nursing journey.',
    button: 'Explore free downloads',
  },
  shopHeading: 'Your next favorite download',
  prototypeNotice: 'Design preview. Product imagery is illustrative and purchasing is not enabled.',
} as const
