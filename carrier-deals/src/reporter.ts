import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AnalyzedDeal, DailyReport } from './types.js';

function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export function generateMarkdownReport(report: DailyReport): string {
  const lines: string[] = [
    `# T-Mobile Switch Deal Report — ${report.date}`,
    '',
    `*Generated: ${new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*`,
    '',
    `## Executive Summary`,
    '',
    report.executiveSummary,
    '',
    `**Posts scanned:** ${report.postsScanned} &nbsp;|&nbsp; **Deals identified:** ${report.dealsFound}`,
    '',
    '---',
    '',
  ];

  if (report.topDeals.length === 0) {
    lines.push('*No actionable deals found today. Check back tomorrow.*');
    return lines.join('\n');
  }

  lines.push('## Top Deals', '');

  for (const deal of report.topDeals) {
    const src = deal.post.source === 'reddit' ? `Reddit · r/${deal.post.subreddit}` : 'X (Twitter)';
    lines.push(
      `### ${deal.post.title.slice(0, 90)}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Source** | ${src} |`,
      `| **Rating** | ${stars(deal.rating)} ${deal.rating}/5 |`,
      `| **Verizon Relevance** | ${deal.relevanceScore}/10 |`,
      `| **Deal Value** | ${deal.dealValue || '—'} |`,
      `| **Posted** | ${deal.post.created.toLocaleDateString('en-US')} |`,
      deal.expirationDate ? `| **Expires** | ${deal.expirationDate} |` : '',
      '',
      deal.summary,
      '',
    );

    if (deal.promoDetails) {
      lines.push(`**Promo details:** ${deal.promoDetails}`, '');
    }

    if (deal.requirements.length > 0) {
      lines.push('**Requirements:**');
      for (const req of deal.requirements) {
        lines.push(`- ${req}`);
      }
      lines.push('');
    }

    lines.push(`**Source link:** ${deal.post.url}`, '', '---', '');
  }

  return lines.filter((l) => l !== undefined).join('\n');
}

export async function saveReport(report: DailyReport, reportsDir: string): Promise<string[]> {
  await mkdir(reportsDir, { recursive: true });

  const slug = report.date.replace(/-/g, '');
  const jsonPath = join(reportsDir, `${slug}-deals.json`);
  const mdPath = join(reportsDir, `${slug}-deals.md`);

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(report, null, 2)),
    writeFile(mdPath, generateMarkdownReport(report)),
  ]);

  return [jsonPath, mdPath];
}

export function printReport(report: DailyReport): void {
  const divider = '='.repeat(70);
  console.log(`\n${divider}`);
  console.log(generateMarkdownReport(report));
  console.log(divider);
}
