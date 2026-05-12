#!/usr/bin/env node
const path = require('path');
const { AnalyticsStore, normalizeRange } = require('../src/analytics/store');

const rootDir = path.join(__dirname, '..');
const dbPath = process.env.ANALYTICS_DB_FILE || path.join(rootDir, 'logs', 'analytics.sqlite');
const range = normalizeRange(process.argv[2] || '7d');
const store = new AnalyticsStore({ dbPath });
const summary = store.getSummary(range);

function printMetric(label, metric) {
    console.log(`${label}: ${metric.pageviews} pageviews, ${metric.uniqueVisitors} unique visitors, ${metric.requests} requests, ${metric.botRequests} bot requests, ${metric.blockedBots} blocked bots`);
}

console.log(`inazu.me analytics report (${range})`);
console.log(`database: ${dbPath}`);
console.log('');
printMetric('today', summary.today);
printMetric('last 7 days', summary.last7Days);
printMetric('last 30 days', summary.last30Days);
printMetric('all time', summary.totals);

console.log('\nTop paths');
console.table(summary.topPaths);

console.log('\nBots');
console.table(summary.bots);

console.log('\nRecent raw events');
console.table(store.getRecentRaw(20));

store.close();
