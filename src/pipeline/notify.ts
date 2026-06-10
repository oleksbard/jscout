import type { JobRecord } from '../types';

export function formatAlertMessage(record: JobRecord): string {
  const score = record.score;
  const posting = record.posting;
  return [
    `🔥 ${score?.score}/100 — ${posting.title} @ ${posting.company}`,
    `${posting.location || 'location unknown'} (${posting.workMode})${record.languageFlag === 'de' ? ' — ⚠️ German posting' : ''}`,
    score?.reasoning ?? '',
    posting.url,
    record.matchFile ? `Tailored material: ${record.matchFile}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatDigestMessage(records: JobRecord[], failingSources: string[]): string {
  const lines: string[] = [`📋 Job digest — ${records.length} new match${records.length === 1 ? '' : 'es'}`];
  if (records.length === 0) {
    lines.push('No new matches in the last 24h.');
  } else {
    records.forEach((r, i) => {
      const de = r.languageFlag === 'de' ? ' ⚠️DE' : '';
      lines.push(`${i + 1}. ${r.score?.score}/100 — ${r.posting.title} @ ${r.posting.company}${de}`);
      lines.push(`   ${r.posting.url}`);
      if (r.matchFile) lines.push(`   📄 ${r.matchFile}`);
    });
  }
  for (const source of failingSources) lines.push(`⚠️ Source failing: ${source}`);
  return lines.join('\n');
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars — split on line boundaries.
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > 4000) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram: HTTP ${res.status} ${await res.text()}`);
  }
}
