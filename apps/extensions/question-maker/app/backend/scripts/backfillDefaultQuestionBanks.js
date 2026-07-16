/**
 * Legacy no-op: default question banks are now ensured by EduAI Core
 * when QM lists/creates banks via the Core API.
 *
 * Usage: node scripts/backfillDefaultQuestionBanks.js
 */
async function main() {
  const { backfillDefaultBanks } = await import('../src/services/questionBankService.js');
  const result = await backfillDefaultBanks();
  console.log('Backfill skipped (Core-owned banks):', result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
