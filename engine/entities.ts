import { getState, uid } from './core.js';

const SKIP = new Set(['user', 'i', 'me', 'someone', 'something', 'it', 'they']);

export function linkEntities(tag: string) {
  const state = getState();
  const facts = state.triples.filter((t) => t.containerTag === tag && t.isLatest !== false);
  state.links = state.links.filter((l) => l.containerTag !== tag);
  const groups = new Map<string, { name: string; ids: string[] }>();
  for (const t of facts) {
    for (const name of [t.subject, t.object]) {
      const key = name.trim().toLowerCase();
      if (key.length < 2 || SKIP.has(key)) continue;
      const row = groups.get(key) || { name: name.trim(), ids: [] };
      if (!row.ids.includes(t.id)) row.ids.push(t.id);
      groups.set(key, row);
    }
  }
  const known = new Map(state.entities.filter((e) => e.containerTag === tag).map((e) => [e.name.toLowerCase(), e]));
  for (const [key, row] of groups) {
    let ent = known.get(key);
    if (!ent) {
      ent = { id: uid('ent'), containerTag: tag, name: row.name, type: 'topic', memoryIds: row.ids.slice(0, 12) };
      state.entities.push(ent);
      known.set(key, ent);
    } else {
      ent.memoryIds = row.ids.slice(0, 12);
    }
    const hub = row.ids[0];
    for (const id of row.ids.slice(1, 8)) {
      state.links.push({ id: uid('lnk'), containerTag: tag, fromId: hub, toId: id, reason: key });
    }
  }
  return { entities: groups.size, links: state.links.filter((l) => l.containerTag === tag).length };
}
