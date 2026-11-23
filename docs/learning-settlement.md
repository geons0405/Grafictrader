# GraficTrader scheduled learning settlement

The scheduled workflow runs every five minutes and calls the protected learning worker. It only processes due observations already recorded in Redis; it does not run AI analysis and does not alter live signals.

## Required secret

1. In Vercel, open the GraficTrader project environment variables and confirm that `CRON_SECRET` exists for Production.
2. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret**.
3. Create a secret named `CRON_SECRET` with exactly the same value as the Vercel Production variable.
4. After this PR is merged into the default branch, use **Actions → GraficTrader learning settlement → Run workflow** once to verify it. The schedule then runs every five minutes.

Never paste the secret into source code, issues, or chat.

## Settlement limits

- Regular market predictions are settled using the same market-data adapter used by the Quant engine. If the worker arrives outside the allowed timing tolerance, the result is marked `unverified` and excluded from skill statistics.
- Binary-options observations are deliberately marked `unverified` by this worker. A public/external market quote is not proof of the exact broker quote at expiry. Exact binary settlement requires a broker-specific, timestamped price feed and must be added as a separate verified adapter.
- GitHub scheduled workflows are best-effort and may start late. They are not a sub-second timer. Short expiries can therefore become unverified.
- Skills are evaluated only on later observations after their training window. They remain in observe-only status and are never auto-applied.
