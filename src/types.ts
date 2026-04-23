export interface ParallelizeTestsConfig {
    /**
     * Enables intra-file split scheduling.
     * When `false`, the launcher falls back to normal WDIO spec scheduling.
     */
    enabled: boolean
    /**
     * Caps how many split jobs from the same spec file may run at the same time.
     *
     * Example:
     * - one file expands into 4 jobs
     * - `maxInstances` is 4
     * - `maxTestsPerFile` is 2
     *
     * Result:
     * only 2 jobs from that file run concurrently, and the other 2 wait.
     *
     * This is a per-file ceiling. It does not increase concurrency beyond
     * `maxInstances` or capability-level limits.
     */
    maxTestsPerFile?: number
    /**
     * Caps how many split jobs may run at the same time across the whole run.
     *
     * Counted job types:
     * - single-test split jobs
     * - grouped residual subset jobs
     *
     * Not counted:
     * - normal spec jobs
     *
     * This is an additional limiter. It does not replace `maxInstances`,
     * capability-level limits, or `maxTestsPerFile`.
     */
    maxSplitInstances?: number
    /**
     * Groups discovered tests into split jobs with up to this many tests each.
     *
     * The default is `1`, which preserves one WDIO worker job per discovered
     * test. Increasing this reduces worker and browser-session startup overhead
     * for files with many short tests.
     */
    batchSize?: number
    /**
     * Optional file path filters.
     * Only spec files matching one of these substring or wildcard patterns
     * are eligible for splitting.
     */
    include?: string[]
    /**
     * Optional split-candidate filters.
     * Matches discovered test file paths using substring or wildcard patterns.
     *
     * This does not match test titles or `fullTitle()` values.
     *
     * Matching tests are split into individual jobs. Non-matching tests stay
     * together in one residual grouped job when a mixed manifest is returned.
     */
    tests?: string[]
    /**
     * Retry count for split jobs.
     * Defaults to `config.specFileRetries` when not provided.
     */
    retries?: number
}

export interface ParallelizeTestsContext {
    phase: 'discover' | 'run'
    specFile: string
    selectorId?: string
    selectorIds?: string[]
}

export interface ParallelSingleTestShard {
    mode: 'run'
    specFile: string
    selectorId: string
    manifestHash: string
}

export interface ParallelSubsetShard {
    mode: 'subset'
    specFile: string
    selectorIds: string[]
    manifestHash: string
}

export type ParallelShard = ParallelSingleTestShard | ParallelSubsetShard

export interface ParallelTestManifestEntry {
    selectorId: string
    fullTitle: string
    suitePath: string[]
    file: string
    retries?: number
}

export interface ParallelTestManifest {
    specFile: string
    tests: ParallelTestManifestEntry[]
    manifestHash: string
    discoveryWarnings?: string[]
    fallbackToSpecLevel?: boolean
}

export type ParallelRuntimeConfig = WebdriverIO.Config & {
    rootDir: string
    mochaOpts: import('./mocha/types.js').MochaOpts
    parallelShard?: ParallelShard
    parallelizeTestsContext?: ParallelizeTestsContext
}

export interface ParallelWorkerArgs {
    ignoredWorkerServices?: string[]
    framework?: string
    user?: string
    key?: string
    watch?: boolean
    parallelShard?: ParallelShard
    parallelizeTestsContext?: ParallelizeTestsContext
    [key: string]: unknown
}

export interface ParallelDiscoveryPayload {
    cid: string
    configFile: string
    specFile: string
    caps: WebdriverIO.Capabilities
    args: ParallelWorkerArgs
}

declare global {
    namespace WebdriverIO {
        interface Config {
            parallelizeTests?: ParallelizeTestsConfig
            parallelShard?: ParallelShard
            parallelizeTestsContext?: ParallelizeTestsContext
        }
    }
}
