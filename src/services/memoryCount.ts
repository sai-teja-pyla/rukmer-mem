/** Same count Container Tags shows in the Memories column. */
export function countMemories(tags: { tag?: string; memories?: number }[], space = 'all') {
  const rows = space && space !== 'all' ? tags.filter((tag) => tag.tag === space) : tags;
  return rows.reduce((sum, tag) => sum + (Number(tag.memories) || 0), 0);
}
