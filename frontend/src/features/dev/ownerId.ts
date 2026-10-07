/** 3 to 20 lower-case letters or digits: the part of a login the operator types (the server enforces the same rule). */
export const OWNER_ID = /^[a-z0-9]{3,20}$/

/**
 * A sensible short ID from a person's name: first name plus the initial of the last ("Sunil Kumar Agarwal" -> "sunila"), at most 10
 * characters, with a number added when taken. A suggestion only: the operator may type any valid ID.
 */
export function suggestOwnerId(name: string, taken: ReadonlySet<string> = new Set()): string {
  const parts = name
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex -- keeps the ASCII range on purpose: everything else is dropped from an owner ID
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|shri|smt)\b\.?/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (!parts.length) return ''
  let id = (parts.length === 1 ? parts[0] : parts[0] + parts[parts.length - 1][0]).slice(0, 10)
  if (id.length < 3) id = (id + parts.join('')).slice(0, 5)
  if (id.length < 3) return ''
  let out = id
  for (let n = 2; taken.has(out); n++) out = id.slice(0, 9) + n
  return out
}

/** The IDs already in use, from every login in the fleet: only the part before @orsquare.com counts (other domains are not ours to clash with). */
export const takenIds = (logins: Iterable<string>): Set<string> =>
  new Set([...logins].filter((l) => l.endsWith('@orsquare.com')).map((l) => l.slice(0, -'@orsquare.com'.length)))
