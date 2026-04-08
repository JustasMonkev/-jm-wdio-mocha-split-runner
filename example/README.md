# Example Scenarios

All checked-in example configs run Chrome headless.

Main scenarios:

- [wdio.conf.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/wdio.conf.ts): split only `mixed.e2e.ts` while leaving `alpha.e2e.ts` as a normal spec job
- [wdio.stock.conf.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/wdio.stock.conf.ts): stock WDIO spec scheduling with split mode disabled
- [wdio.global-limit.conf.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/wdio.global-limit.conf.ts): two split files with `maxSplitInstances: 2`
- [wdio.retry.conf.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/wdio.retry.conf.ts): shard-level retry example for a flaky split test

Supporting specs:

- [specs/mixed.e2e.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/specs/mixed.e2e.ts)
- [specs/limit-a.e2e.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/specs/limit-a.e2e.ts)
- [specs/limit-b.e2e.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/specs/limit-b.e2e.ts)
- [specs/flaky.e2e.ts](/Users/justas/Desktop/custom-runner/custom-runner/example/specs/flaky.e2e.ts)

Run them from this package repo:

```bash
npm run example:split
npm run example:stock
npm run example:global-limit
npm run example:retry
```
