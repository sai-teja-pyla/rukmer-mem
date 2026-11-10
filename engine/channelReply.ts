/** The Slack user who mentioned the bot, not whoever connected the workspace first. */
export function slackAccountForMention(accounts: { uid: string; slackUserId: string }[], slackUserId: string) {
  const id = String(slackUserId || '').trim();
  if (!id) return '';
  return accounts.find((account) => account.slackUserId === id)?.uid || '';
}

/** A channel is shared. Private rows stay out even when the mentioner owns them. */
export function linesVisibleInChannel(rows: { text: string; visibility?: string | null }[]) {
  return rows
    .filter((row) => row.visibility === 'team' || row.visibility === 'org')
    .map((row) => String(row.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}
