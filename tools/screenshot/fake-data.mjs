// Fake profile for the README screenshot. Real public URLs, so Chrome has favicons and titles
// to show; names and folders are made up.

export const SPACES = [
  {
    id: 'space-work',
    name: 'Work',
    icon: '💼',
    color: 'blue',
    folder: [
      { title: 'Q4 roadmap', url: 'https://www.notion.so/' },
      { title: 'Design system', url: 'https://www.figma.com/' },
      { title: 'Sprint board', url: 'https://linear.app/' },
      {
        title: 'Reading',
        children: [
          { title: 'Designing Data-Intensive Applications', url: 'https://dataintensive.net/' },
          { title: 'Refactoring', url: 'https://martinfowler.com/' },
        ],
      },
      {
        title: 'Team',
        children: [
          { title: 'On-call runbook', url: 'https://github.com/' },
          { title: 'Standup notes', url: 'https://docs.google.com/' },
        ],
      },
    ],
    archive: [
      { title: 'Vite guide', url: 'https://vite.dev/guide/' },
      { title: 'Postmortem template', url: 'https://www.atlassian.com/incident-management/postmortem' },
      { title: 'Release checklist', url: 'https://github.com/features/actions' },
    ],
    tabs: [
      'https://react.dev/learn',
      'https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
      'https://www.typescriptlang.org/docs/handbook/intro.html',
      'https://en.wikipedia.org/wiki/Arc_(web_browser)',
      'https://news.ycombinator.com/',
    ],
    // Bookmarks opened as Arc-style tabs, by title; the last one ends up active
    open: ['Design system', 'Q4 roadmap'],
    // Folders expanded in the tree
    expand: ['Reading'],
  },
  {
    id: 'space-personal',
    name: 'Personal',
    icon: '🏠',
    color: 'green',
    folder: [
      { title: 'Budget', url: 'https://www.google.com/sheets/about/' },
      { title: 'Recipes', url: 'https://www.seriouseats.com/' },
    ],
  },
  {
    id: 'space-travel',
    name: 'Travel',
    icon: '✈️',
    color: 'orange',
    folder: [
      { title: 'Flights LIS to BER', url: 'https://www.google.com/travel/flights' },
      { title: 'Lisbon map', url: 'https://www.openstreetmap.org/' },
    ],
  },
];

export const FAVORITES = [
  { title: 'Spotify', url: 'https://open.spotify.com/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { title: 'Reddit', url: 'https://www.reddit.com/' },
  { title: 'MDN', url: 'https://developer.mozilla.org/' },
];
