import 'dotenv/config';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { searchReddit } from './reddit.js';
import { searchTwitter } from './twitter.js';
import { analyzePosts, generateExecutiveSummary } from './analyzer.js';
import { saveReport, printReport } from './reporter.js';
import type { DailyReport } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\nT-Mobile Deal Search — ${today}`);
  console.log('Searching Reddit and X for deals (Verizon → T-Mobile)...\n');

  const [redditPosts, twitterPosts] = await Promise.all([searchReddit(), searchTwitter()]);

  const allPosts = [...redditPosts, ...twitterPosts];
  console.log(
    `\nFetched: ${redditPosts.length} Reddit posts, ${twitterPosts.length} X/Twitter posts`,
  );

  if (allPosts.length === 0) {
    console.log('No posts retrieved. Check your network or API keys.');
    process.exit(0);
  }

  console.log('\nAnalyzing with Claude AI...');
  const deals = await analyzePosts(allPosts);
  console.log(`Identified ${deals.length} relevant deals`);

  const executiveSummary = await generateExecutiveSummary(deals, today);

  const report: DailyReport = {
    date: today,
    generatedAt: new Date().toISOString(),
    postsScanned: allPosts.length,
    dealsFound: deals.length,
    topDeals: deals,
    executiveSummary,
  };

  printReport(report);

  const reportsDir = join(__dirname, '..', 'reports');
  const [jsonPath, mdPath] = await saveReport(report, reportsDir);
  console.log(`\nReports saved:\n  ${jsonPath}\n  ${mdPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
