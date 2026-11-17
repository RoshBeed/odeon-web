// How ODEON's raw tags and addresses are grouped and named for people.

// A picture format, or one of ODEON's variants of it: "IMAX 3D_Web", "XL 3D Web", "Laser 3D".
const PICTURE = /^(IMAX|3D|4K|Dolby|Laser|iSense|XL|Infinity Vision)\b/;
const SUBTITLES = new Set(['English (Sub)', 'Open Captioned']);
// Seat types ODEON also lists among a showing's tags; the Seating menu covers them.
const SEATS = new Set(['Recliner', 'ODEON Luxe', 'Luxe Suite', 'VIP Bed']);
const ACCESS = new Set(['Wheelchair Accessible', 'Audio Described', 'Autism Friendly', 'Flash Warning', 'Watchword']);
const PRICING = new Set(['Saver', 'Bargain Wednesday']);
const LABELS: Record<string, string> = {
  'English (Sub)': 'English subtitles',
  'Open Captioned': 'Captioned',
};

export type TagKind = 'Picture' | 'Language' | 'Accessibility' | 'Events' | 'Seating' | 'Pricing';

export function tagKind(tag: string): TagKind {
  if (PICTURE.test(tag)) return 'Picture';
  if (tag.endsWith(' (Audio)') || tag === 'Dubbed' || SUBTITLES.has(tag)) return 'Language';
  if (ACCESS.has(tag)) return 'Accessibility';
  if (SEATS.has(tag)) return 'Seating';
  if (PRICING.has(tag) || (/^[£€$]/.test(tag) && /web$/i.test(tag))) return 'Pricing';
  return 'Events'; // anything new ODEON invents shows up here
}

/** Without what ODEON adds for its own use: "Hindi (Audio)", "3D - Web", "XL 3D Web". */
export const tagLabel = (tag: string) => LABELS[tag] ?? tag.replace(/ \(Audio\)$/, '').replace(/[ _-]+web$/i, '');

/** The tags worth a table column: picture and language. */
export function formats(tags: string[], kinds: TagKind[] = ['Picture', 'Language']): string {
  return tags.filter((tag) => kinds.includes(tagKind(tag))).map(tagLabel).join(', ');
}

/** Greater London's cinemas, among them outer boroughs whose address city is not London. */
export const LONDON = new Set('090 125 153 155 158 200 486 536 555 593 694 695 838 852 858 888 949 963 995'.split(' '));
// Some ODEON addresses use a street, county or postcode as their city.
const PLACES: Record<string, string> = {
  '031': 'Dublin', '033': 'Dublin', '044': 'Dundee', '075': 'Waterford', '076': 'Dublin', '078': 'Dublin',
  '086': 'Exeter', '508': 'Dunfermline', '530': 'Glasgow', '615': 'Glasgow', '750': 'Edinburgh',
  '755': 'Andover', '758': 'Loughborough', '853': 'Northwich', '954': 'Cardiff', '955': 'Manchester',
};

export function place(cinema: { id: string; name: string; city: string }): string {
  if (LONDON.has(cinema.id)) return 'Greater London';
  return PLACES[cinema.id] ?? (cinema.city.trim().replace(/\s+/g, ' ') || cinema.name);
}

export const shortCinema = (name: string) => name.replace(/^London /, '');

/** The youngest age a certificate admits, to sort by: U, PG, 12A, 15, 18.
 *  Null for a film not yet rated, which sorts last. */
export function certificateAge(certificate: string): number | null {
  const [first = ''] = certificate.trim().split(' '); // "PG Ire"
  if (first === 'U' || first === 'G') return 0;
  if (first === 'PG') return 8;
  const age = parseInt(first, 10); // 12A, 15, 15A, 16, 18
  return Number.isNaN(age) ? null : age;
}
