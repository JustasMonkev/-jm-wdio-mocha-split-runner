import { fork } from 'node:child_process'
import { basename, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import exitHook from 'async-exit-hook'
import { resolve } from 'import-meta-resolve'

import { Launcher as StockLauncher } from '@wdio/cli'
import logger from '@wdio/logger'
import { DEFAULT_MAX_INSTANCES_PER_CAPABILITY_VALUE } from '@wdio/config'
import { ConfigParser } from '@wdio/config/node'
import { initializePlugin, initializeLauncherService, sleep, enableFileLogging } from '@wdio/utils'
import { setupDriver, setupBrowser } from '@wdio/utils/node'
import type { Capabilities, Services } from '@wdio/types'

import CLInterface from './cli/interface.js'
import { runLauncherHook, runOnCompleteHook, runServiceHook, nodeVersion, type HookError } from './cli/utils.js'
import { WORKER_GROUPLOGS_MESSAGES } from './cli/constants.js'
import type { ParallelDiscoveryPayload, ParallelDiscoveryResponse, ParallelTestManifest, ParallelWorkerArgs, ParallelizeTestsConfig } from './types.js'
import { getDiscoveryIgnoredWorkerServices, getDiscoveryLauncherServices } from './browserstack.js'

const log = logger('@jm/wdio-mocha-split-runner')

interface ParallelWorkerSpecs {
    files: string[]
    retries: number
    rid?: string
    jobType?: 'spec' | 'test' | 'subset'
    specFile?: string
    selectorId?: string
    selectorIds?: string[]
    manifestHash?: string
}

interface Schedule {
    cid: number
    caps: WebdriverIO.Capabilities
    specs: ParallelWorkerSpecs[]
    availableInstances: number
    runningInstances: number
}

export interface EndMessage {
    cid: string
    exitCode: number
    specs: string[]
    retries: number
}

const TS_FILE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

export default class ParallelLauncher {
    #isInitialized = false

    public configParser: ConfigParser
    public isMultiremote = false
    public isParallelMultiremote = false
    public runner?: Services.RunnerInstance
    public interface?: CLInterface

    private _exitCode = 0
    private _hasTriggeredExitRoutine = false
    private _schedule: Schedule[] = []
    private _rid: number[] = []
    private _runnerStarted = 0
    private _runnerFailed = 0

    private _launcher?: Services.ServiceInstance[]
    private _resolve?: (exitCode: number) => void
    private _runningJobs = new Map<string, ParallelWorkerSpecs>()
    private _jobStartTimes = new Map<string, number>()

    constructor(
        private _configFilePath: string,
        private _args: ParallelWorkerArgs = {},
        private _isWatchMode = false
    ) {
        this.configParser = new ConfigParser(this._configFilePath, this._args)
    }

    async run(): Promise<undefined | number> {
        await this.initialize()
        const config = this.configParser.getConfig()
        const parallelConfig = config.parallelizeTests

        if (!parallelConfig?.enabled) {
            return new StockLauncher(this._configFilePath, this._args, this._isWatchMode).run()
        }

        if (config.framework !== 'mocha') {
            throw new Error('`parallelizeTests.enabled` currently supports only `framework: "mocha"`')
        }

        if (this._isWatchMode) {
            log.warn('Split test execution is not supported in watch mode yet, falling back to spec-level scheduling')
            return new StockLauncher(this._configFilePath, this._args, this._isWatchMode).run()
        }

        const capabilities = this.configParser.getCapabilities()
        this.isParallelMultiremote = Array.isArray(capabilities) &&
            capabilities.length > 0 &&
            capabilities.every(cap => Object.values(cap).length > 0 && Object.values(cap).every(c => typeof c === 'object' && c !== null && 'capabilities' in c && c.capabilities))
        this.isMultiremote = this.isParallelMultiremote || !Array.isArray(capabilities)

        await enableFileLogging(config.outputDir)
        logger.setLogLevelsConfig(config.logLevels, config.logLevel)

        const [runnerName, runnerOptions] = Array.isArray(config.runner) ? config.runner : [config.runner, {}]
        // SAFETY: initializePlugin resolves a WDIO runner module whose default export implements RunnerPlugin.
        const Runner = (await initializePlugin(runnerName, 'runner') as Services.RunnerPlugin).default
        this.runner = new Runner(runnerOptions, config)

        exitHook(this._exitHandler.bind(this))
        let exitCode = 0
        let error: HookError | undefined
        // SAFETY: The testrunner parser returns the configured capability list or multiremote map.
        const caps = this.configParser.getCapabilities() as Capabilities.TestrunnerCapabilities

        try {
            const { ignoredWorkerServices, launcherServices } = await initializeLauncherService(config, caps)
            this._launcher = launcherServices
            this._args.ignoredWorkerServices = ignoredWorkerServices

            await this.runner.initialize()

            log.info('Run onPrepare hook')
            await runLauncherHook(config.onPrepare, config, caps)
            await runServiceHook(this._launcher, 'onPrepare', config, caps)

            const totalWorkerCnt = Array.isArray(capabilities)
                ? capabilities.map((c) => {
                    if (this.isParallelMultiremote) {
                        const keys = Object.keys(c)
                        // SAFETY: isParallelMultiremote checked that every entry has a capabilities object.
                        const cap = (c as Capabilities.RequestedMultiremoteCapabilities)[keys[0]].capabilities as WebdriverIO.Capabilities
                        return this.configParser.getSpecs(cap['wdio:specs'], cap['wdio:exclude']).length
                    }
                    // SAFETY: The capability array was classified above; this is its standalone branch.
                    const standaloneCaps = c as Capabilities.RequestedStandaloneCapabilities
                    const cap = 'alwaysMatch' in standaloneCaps ? standaloneCaps.alwaysMatch : standaloneCaps
                    return this.configParser.getSpecs(cap['wdio:specs'], cap['wdio:exclude']).length
                }).reduce((a, b) => a + b, 0)
                : 1

            this.interface = new CLInterface(config, totalWorkerCnt, this._isWatchMode)
            config.runnerEnv!.FORCE_COLOR = Number(this.interface.hasAnsiSupport).toString()

            await Promise.all([
                setupDriver(config, caps),
                setupBrowser(config, caps)
            ])

            exitCode = await this._runMode(config, caps)
            await logger.waitForBuffer()
            this.interface.finalise()
        } catch (err) {
            error = err as HookError
        } finally {
            if (!this._hasTriggeredExitRoutine) {
                this._hasTriggeredExitRoutine = true
                const passesCodeCoverage = await this.runner.shutdown()
                if (!passesCodeCoverage) {
                    exitCode = exitCode || 1
                }
            }

            exitCode = await this.#runOnCompleteHook(config, caps, exitCode)
        }

        if (error) {
            if (this.interface) {
                this.interface.logHookError(error)
            }
            throw error
        }

        return exitCode
    }

    async initialize() {
        if (this.#isInitialized) {
            return
        }

        const tsxPath = resolve('tsx', import.meta.url)
        if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes(tsxPath)) {
            const moduleLoaderFlag = nodeVersion('major') >= 21 ||
                (nodeVersion('major') === 20 && nodeVersion('minor') >= 6) ||
                (nodeVersion('major') === 18 && nodeVersion('minor') >= 19) ? '--import' : '--loader'
            process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${moduleLoaderFlag} ${tsxPath}`
        }

        if (TS_FILE_EXTENSIONS.some((ext) => this._configFilePath.endsWith(ext))) {
            await import(tsxPath)
        }

        this.#isInitialized = true
        await this.configParser.initialize(this._args)
    }

    async #runOnCompleteHook(
        config: Required<WebdriverIO.Config>,
        caps: Capabilities.TestrunnerCapabilities,
        exitCode: number
    ): Promise<number> {
        log.info('Run onComplete hook')
        const onCompleteResults = await runOnCompleteHook(config.onComplete!, config, caps, exitCode, this.interface?.result || { finished: 0, passed: 0, retries: 0, failed: 0 })
        if (this._launcher) {
            await runServiceHook(this._launcher, 'onComplete', exitCode, config, caps)
        }

        return onCompleteResults.includes(1) ? 1 : exitCode
    }

    private _validateParallelConfig(config: Required<WebdriverIO.Config>) {
        const parallel = config.parallelizeTests
        if (parallel?.enabled && (config.mochaOpts?.retries || 0) > 0) {
            throw new Error('`mochaOpts.retries` must be 0 when `parallelizeTests.enabled` is true')
        }
        if (parallel?.enabled && config.framework !== 'mocha') {
            throw new Error('`parallelizeTests.enabled` currently supports only `framework: "mocha"`')
        }
        if (parallel?.maxSplitInstances !== undefined && (!Number.isInteger(parallel.maxSplitInstances) || parallel.maxSplitInstances < 1)) {
            throw new Error('`parallelizeTests.maxSplitInstances` must be an integer greater than 0 when set')
        }
        if (parallel?.batchSize !== undefined && (!Number.isInteger(parallel.batchSize) || parallel.batchSize < 1)) {
            throw new Error('`parallelizeTests.batchSize` must be an integer greater than 0 when set')
        }
    }

    private async _runMode(config: Required<WebdriverIO.Config>, caps?: Capabilities.TestrunnerCapabilities): Promise<number> {
        this._validateParallelConfig(config)

        if (
            !caps ||
            (Array.isArray(caps) && caps.length === 0) ||
            (!Array.isArray(caps) && Object.keys(caps).length === 0)
        ) {
            log.error('Missing capabilities, exiting with failure')
            return 1
        }

        const parallelConfig = config.parallelizeTests || { enabled: false }
        const parallelEnabled = parallelConfig.enabled

        const specFileRetries = this._isWatchMode ? 0 : -1

        let cid = 0
        if (!Array.isArray(caps)) {
            const specs = this._formatSpecs(caps, specFileRetries)
            this._schedule.push({
                cid: cid++,
                caps: caps,
                specs: parallelEnabled
                    ? await this._expandSplitSpecs(specs, caps, specFileRetries, config)
                    : specs,
                availableInstances: config.maxInstances || 1,
                runningInstances: 0
            })
        } else {
            for (const capabilities of caps) {
                // SAFETY: WDIO workers accept the original requested capability object; extension fields apply to standalone jobs.
                const workerCaps = capabilities as WebdriverIO.Capabilities
                const availableInstances = this.isParallelMultiremote
                    ? config.maxInstances || 1
                    : config.runner === 'browser'
                        ? 1
                        : workerCaps['wdio:maxInstances'] || config.maxInstancesPerCapability || DEFAULT_MAX_INSTANCES_PER_CAPABILITY_VALUE
                const specs = this._formatSpecs(capabilities, specFileRetries)
                this._schedule.push({
                    cid: cid++,
                    caps: workerCaps,
                    specs: parallelEnabled
                        ? await this._expandSplitSpecs(specs, workerCaps, specFileRetries, config)
                        : specs,
                    availableInstances,
                    runningInstances: 0
                })
            }
        }

        if (this.interface) {
            this.interface.totalWorkerCnt = this._schedule.reduce((count, session) => count + session.specs.length, 0)
            this.interface.onStart()
        }

        return new Promise<number>((resolve) => {
            this._resolve = resolve

            if (this._schedule.reduce((specCnt, schedule) => specCnt + schedule.specs.length, 0) === 0) {
                const { total, current } = config.shard
                if (total > 1) {
                    log.info(`No specs to execute in shard ${current}/${total}, exiting!`)
                    return resolve(0)
                }

                log.error('No specs found to run, exiting with failure')
                return resolve(1)
            }

            if (this._runSpecs()) {
                resolve(0)
            }
        })
    }

    private _formatSpecs(
        capabilities: Capabilities.RequestedMultiremoteCapabilities | Capabilities.RequestedStandaloneCapabilities,
        specFileRetries: number
    ): ParallelWorkerSpecs[] {
        // SAFETY: Standalone overrides are capability fields; multiremote maps use the parser's global specs.
        const caps = ('alwaysMatch' in capabilities ? capabilities.alwaysMatch : capabilities) as WebdriverIO.Capabilities

        const specs = (
            // @ts-expect-error deprecated
            caps.specs ||
            caps['wdio:specs']
        )
        const excludes = (
            // @ts-expect-error deprecated
            caps.exclude ||
            caps['wdio:exclude']
        )
        const files = this.configParser.getSpecs(specs, excludes)

        return files.map((file: string | string[]) => {
            if (typeof file === 'string') {
                return { files: [file], retries: specFileRetries, jobType: 'spec' as const }
            } else if (Array.isArray(file)) {
                return { files: file, retries: specFileRetries, jobType: 'spec' as const }
            }
            log.warn('Unexpected entry in specs that is neither string nor array: ', file)
            return { files: [], retries: specFileRetries, jobType: 'spec' as const }
        })
    }

    private async _expandSplitSpecs(
        specs: ParallelWorkerSpecs[],
        caps: WebdriverIO.Capabilities,
        specFileRetries: number,
        config: Required<WebdriverIO.Config>
    ): Promise<ParallelWorkerSpecs[]> {
        const parallelConfig = config.parallelizeTests || { enabled: false }
        const expandedSpecs: ParallelWorkerSpecs[] = []

        for (const spec of specs) {
            if (spec.files.length !== 1) {
                expandedSpecs.push(spec)
                continue
            }

            if (!this._shouldSplitSpec(spec.files[0], parallelConfig)) {
                expandedSpecs.push(spec)
                continue
            }

            let manifest: ParallelTestManifest
            try {
                manifest = await this._discoverSpecsForFile(spec.files[0], caps)
            } catch (err) {
                if (this._isLikelyDiscoveryFallbackError(err as Error)) {
                    log.warn(`Falling back to spec-level execution for ${spec.files[0]}: ${(err as Error).message}`)
                    expandedSpecs.push(spec)
                    continue
                }
                throw err
            }

            if (manifest.fallbackToSpecLevel || manifest.tests.length === 0) {
                for (const warning of manifest.discoveryWarnings || []) {
                    log.warn(`Falling back to spec-level execution for ${manifest.specFile}: ${warning}`)
                }
                expandedSpecs.push(spec)
                continue
            }

            const splitCandidates = this._getSplitCandidates(manifest, parallelConfig)
            if (splitCandidates.length === 0) {
                expandedSpecs.push(spec)
                continue
            }

            const residualCandidates = manifest.tests.filter((test) => !splitCandidates.some((candidate) => candidate.selectorId === test.selectorId))

            this._addSplitCandidateJobs(expandedSpecs, manifest, splitCandidates, parallelConfig, specFileRetries)

            if (residualCandidates.length > 0) {
                expandedSpecs.push({
                    files: [manifest.specFile],
                    retries: parallelConfig.retries ?? specFileRetries,
                    jobType: 'subset',
                    specFile: manifest.specFile,
                    selectorIds: residualCandidates.map((test) => test.selectorId),
                    manifestHash: manifest.manifestHash
                })
            }
        }

        return expandedSpecs
    }

    private _addSplitCandidateJobs(
        expandedSpecs: ParallelWorkerSpecs[],
        manifest: ParallelTestManifest,
        splitCandidates: ParallelTestManifest['tests'],
        parallelConfig: ParallelizeTestsConfig,
        specFileRetries: number
    ) {
        const batchSize = parallelConfig.batchSize || 1

        for (let index = 0; index < splitCandidates.length; index += batchSize) {
            const batch = splitCandidates.slice(index, index + batchSize)
            if (batch.length === 1) {
                const [test] = batch
                expandedSpecs.push({
                    files: [manifest.specFile],
                    retries: parallelConfig.retries ?? test.retries ?? specFileRetries,
                    jobType: 'test',
                    specFile: manifest.specFile,
                    selectorId: test.selectorId,
                    manifestHash: manifest.manifestHash
                })
                continue
            }

            expandedSpecs.push({
                files: [manifest.specFile],
                retries: parallelConfig.retries ?? specFileRetries,
                jobType: 'subset',
                specFile: manifest.specFile,
                selectorIds: batch.map((test) => test.selectorId),
                manifestHash: manifest.manifestHash
            })
        }
    }

    private _getSplitCandidates(manifest: ParallelTestManifest, parallelConfig: ParallelizeTestsConfig) {
        if (!parallelConfig.tests || parallelConfig.tests.length === 0) {
            return manifest.tests
        }

        return manifest.tests.filter((test) => this._matchesAnyPattern(
            this._getPathMatchCandidates(test.file || manifest.specFile),
            parallelConfig.tests!
        ))
    }

    private _shouldSplitSpec(specFile: string, parallelConfig: ParallelizeTestsConfig) {
        if (!parallelConfig.include || parallelConfig.include.length === 0) {
            return true
        }

        return this._matchesAnyPattern(this._getPathMatchCandidates(specFile), parallelConfig.include)
    }

    private _matchesAnyPattern(candidates: string[], patterns: string[]) {
        return patterns.some((pattern) => candidates.some((candidate) => this._matchesPattern(candidate, pattern)))
    }

    private _matchesPattern(value: string, pattern: string) {
        if (!this._containsWildcard(pattern)) {
            return value.includes(pattern)
        }

        return this._globToRegExp(pattern).test(this._normalizeForMatch(value))
    }

    private _containsWildcard(pattern: string) {
        return /[*?]/.test(pattern)
    }

    private _getPathMatchCandidates(specFile: string) {
        const candidates = new Set<string>()
        candidates.add(this._normalizeForMatch(specFile))

        const filePath = specFile.startsWith('file://') ? fileURLToPath(specFile) : specFile
        candidates.add(this._normalizeForMatch(filePath))
        candidates.add(this._normalizeForMatch(relative(process.cwd(), filePath)))
        candidates.add(this._normalizeForMatch(basename(filePath)))

        return Array.from(candidates)
    }

    private _normalizeForMatch(value: string) {
        return value.replace(/\\/g, '/')
    }

    private _globToRegExp(pattern: string) {
        const normalizedPattern = this._normalizeForMatch(pattern)
        let regex = '^'

        for (let i = 0; i < normalizedPattern.length; i++) {
            const char = normalizedPattern[i]
            const nextChar = normalizedPattern[i + 1]

            if (char === '*' && nextChar === '*') {
                regex += '.*'
                i++
                continue
            }

            if (char === '*') {
                regex += '[^/]*'
                continue
            }

            if (char === '?') {
                regex += '[^/]'
                continue
            }

            regex += /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char
        }

        regex += '$'
        return new RegExp(regex)
    }

    private _isLikelyDiscoveryFallbackError(error: Error) {
        return /not fully initialized|browser object/i.test(error.message)
    }

    private _getParallelLimit(config: Required<WebdriverIO.Config>) {
        return config.parallelizeTests?.maxTestsPerFile || config.maxInstances
    }

    private _isSplitJob(job: ParallelWorkerSpecs) {
        return job.jobType === 'test' || job.jobType === 'subset'
    }

    private _getSplitJobLimit(config: Required<WebdriverIO.Config>) {
        return config.parallelizeTests?.maxSplitInstances
    }

    private _getRunningTestsForSpecFile(specFile: string) {
        let running = 0
        for (const [, job] of this._runningJobs) {
            if (this._isSplitJob(job) && job.specFile === specFile) {
                running++
            }
        }
        return running
    }

    private _getNumberOfRunningSplitJobs() {
        let running = 0
        for (const [, job] of this._runningJobs) {
            if (this._isSplitJob(job)) {
                running++
            }
        }
        return running
    }

    private _findSchedulableJobIndex(schedule: Schedule, config: Required<WebdriverIO.Config>) {
        const parallelLimit = this._getParallelLimit(config)
        const splitJobLimit = this._getSplitJobLimit(config)
        return schedule.specs.findIndex((job) => {
            if (job.jobType === 'spec' || !job.specFile) {
                return true
            }

            if (splitJobLimit !== undefined && this._getNumberOfRunningSplitJobs() >= splitJobLimit) {
                return false
            }

            return this._getRunningTestsForSpecFile(job.specFile) < parallelLimit
        })
    }

    private _runSpecs(): boolean {
        if (this._hasTriggeredExitRoutine) {
            return true
        }

        const config = this.configParser.getConfig()

        while (this._getNumberOfRunningInstances() < config.maxInstances) {
            const schedulableCaps = this._schedule
                .filter((session) => {
                    const filter = typeof config.bail !== 'number' || config.bail < 1 || config.bail > this._runnerFailed
                    if (!filter) {
                        this._schedule.forEach((t) => { t.specs = [] })
                        return false
                    }

                    if (this._getNumberOfRunningInstances() >= config.maxInstances) {
                        return false
                    }

                    return session.availableInstances > 0 && session.specs.length > 0 && this._findSchedulableJobIndex(session, config) >= 0
                })
                .sort((a, b) => a.runningInstances - b.runningInstances)

            if (schedulableCaps.length === 0) {
                break
            }

            const session = schedulableCaps[0]
            const jobIndex = this._findSchedulableJobIndex(session, config)
            const [specs] = session.specs.splice(jobIndex, 1)
            this._startInstance(specs, session.caps, session.cid)
            session.availableInstances--
            session.runningInstances++
        }

        return this._getNumberOfRunningInstances() === 0 && this._getNumberOfSpecsLeft() === 0
    }

    private _getNumberOfRunningInstances(): number {
        return this._schedule.reduce((count, session) => count + session.runningInstances, 0)
    }

    private _getNumberOfSpecsLeft(): number {
        return this._schedule.reduce((count, session) => count + session.specs.length, 0)
    }

    private async _discoverSpecsForFile(specFile: string, caps: WebdriverIO.Capabilities): Promise<ParallelTestManifest> {
        const startedAt = Date.now()
        const config = this.configParser.getConfig()
        const discoveryArgs = {
            ...this._buildWorkerArgs(config),
            ignoredWorkerServices: getDiscoveryIgnoredWorkerServices(config.services || [], this._args.ignoredWorkerServices),
            parallelizeTestsContext: {
                phase: 'discover' as const,
                specFile
            }
        }

        const runnerId = `discover-${Date.now()}-${Math.random()}`
        const execArgv = [...(process.execArgv || []), ...(this.configParser.getConfig().execArgv || [])]
        const workerCaps = structuredClone(caps)

        log.info('Run onWorkerStart hook for discovery job')
        await runLauncherHook(config.onWorkerStart, runnerId, workerCaps, [specFile], discoveryArgs, execArgv)
        await runServiceHook(
            getDiscoveryLauncherServices(this._launcher || [], config.services || []),
            'onWorkerStart',
            runnerId,
            workerCaps,
            [specFile],
            discoveryArgs,
            execArgv
        )

        const manifest = await this._runDiscoveryWorker({
            cid: runnerId,
            configFile: this._configFilePath,
            specFile,
            caps: workerCaps,
            args: discoveryArgs
        }, execArgv)
        log.debug(`[perf] discovery for ${specFile} completed in ${Date.now() - startedAt}ms (${manifest.tests.length} tests)`)
        return manifest
    }

    private async _startInstance(
        job: ParallelWorkerSpecs,
        caps: Capabilities.ResolvedTestrunnerCapabilities,
        cid: number
    ) {
        if (!this.runner || !this.interface) {
            throw new Error('Internal Error: no runner initialized, call run() first')
        }

        const config = this.configParser.getConfig()

        if (typeof config.specFileRetriesDelay === 'number' && config.specFileRetries > 0 && config.specFileRetries !== job.retries) {
            await sleep(config.specFileRetriesDelay * 1000)
        }

        const runnerId = job.rid || this._getRunnerId(cid)
        const processNumber = this._runnerStarted + 1
        const debugArgs = []
        let debugType
        let debugHost = ''
        const debugPort = process.debugPort
        for (const arg of process.execArgv) {
            const debugArgs = arg.match('--(debug|inspect)(?:-brk)?(?:=(.*):)?')
            if (debugArgs) {
                const [, type, host] = debugArgs
                if (type) {
                    debugType = type
                }
                if (host) {
                    debugHost = `${host}:`
                }
            }
        }
        if (debugType) {
            debugArgs.push(`--${debugType}=${debugHost}${(debugPort + processNumber)}`)
        }

        const capExecArgs = [...(config.execArgv || [])]
        const defaultArgs = capExecArgs.length ? process.execArgv : []
        const execArgv = [...defaultArgs, ...debugArgs, ...capExecArgs]

        this._runnerStarted++
        const workerCaps = structuredClone(caps)
        const reservedJob = { ...job, rid: runnerId }
        const startedAt = Date.now()

        this._runningJobs.set(runnerId, reservedJob)
        this._jobStartTimes.set(runnerId, startedAt)

        const workerArgs = {
            ...this._buildWorkerArgs(config),
            ...(job.jobType === 'test' && job.specFile && job.selectorId && job.manifestHash
                ? {
                    parallelShard: {
                        mode: 'run' as const,
                        specFile: job.specFile,
                        selectorId: job.selectorId,
                        manifestHash: job.manifestHash
                    },
                    parallelizeTestsContext: {
                        phase: 'run' as const,
                        specFile: job.specFile,
                        selectorId: job.selectorId
                    }
                }
                : job.jobType === 'subset' && job.specFile && job.selectorIds && job.manifestHash
                    ? {
                        parallelShard: {
                            mode: 'subset' as const,
                            specFile: job.specFile,
                            selectorIds: job.selectorIds,
                            manifestHash: job.manifestHash
                        },
                        parallelizeTestsContext: {
                            phase: 'run' as const,
                            specFile: job.specFile,
                            selectorIds: job.selectorIds
                        }
                    }
                : {})
        }

        log.info('Run onWorkerStart hook')
        try {
            await runLauncherHook(config.onWorkerStart, runnerId, workerCaps, job.files, workerArgs, execArgv)
                .catch((error) => this._workerHookError(error))
            await runServiceHook(this._launcher!, 'onWorkerStart', runnerId, workerCaps, job.files, workerArgs, execArgv)
                .catch((error) => this._workerHookError(error))

            const worker = await this.runner.run({
                cid: runnerId,
                command: 'run',
                configFile: this._configFilePath,
                args: workerArgs,
                caps: workerCaps,
                specs: job.files,
                execArgv,
                retries: job.retries
            })
            log.debug(`[perf] worker ${runnerId} started in ${Date.now() - startedAt}ms (${job.jobType || 'spec'})`)
            worker.on('message', this.interface.onMessage.bind(this.interface))
            worker.on('error', this.interface.onMessage.bind(this.interface))
            worker.on('exit', (code) => {
                if (!this.configParser.getConfig().groupLogsByTestSpec) {
                    return
                }
                if (code.exitCode === 0) {
                    console.log(WORKER_GROUPLOGS_MESSAGES.normalExit(code.cid))
                } else {
                    console.log(WORKER_GROUPLOGS_MESSAGES.exitWithError(code.cid))
                }
                worker.logsAggregator.forEach((logLine) => {
                    console.log(logLine.replace(new RegExp('\\n$'), ''))
                })
            })
            worker.on('exit', this._endHandler.bind(this))
        } catch (error) {
            this._runningJobs.delete(runnerId)
            this._jobStartTimes.delete(runnerId)
            throw error
        }
    }

    private _workerHookError(error: HookError) {
        if (!this.interface) {
            throw new Error('Internal Error: no interface initialized, call run() first')
        }

        this.interface.logHookError(error)
        if (this._resolve) {
            this._resolve(1)
        }
    }

    private _buildWorkerArgs(config: Required<WebdriverIO.Config>): ParallelWorkerArgs {
        return {
            ...this._args,
            framework: this._getLocalModulePath('framework'),
            user: config.user,
            key: config.key
        }
    }

    private _getLocalModulePath(moduleName: string) {
        const extension = extname(fileURLToPath(import.meta.url))
        return fileURLToPath(new URL(`./${moduleName}${extension}`, import.meta.url))
    }

    private _runDiscoveryWorker(payload: ParallelDiscoveryPayload, execArgv: string[]) {
        return new Promise<ParallelTestManifest>((resolve, reject) => {
            const worker = fork(this._getLocalModulePath('discover'), [], {
                cwd: process.cwd(),
                stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
                execArgv
            })

            const cleanup = () => {
                worker.removeAllListeners('message')
                worker.removeAllListeners('error')
                worker.removeAllListeners('exit')
            }

            worker.on('message', (message: ParallelDiscoveryResponse) => {
                if (!message || typeof message !== 'object') return
                if ('ready' in message && message.ready) {
                    worker.send(payload)
                    return
                }
                if (message.ok && 'manifest' in message && message.manifest) {
                    cleanup()
                    resolve(message.manifest)
                    return
                }
                if (message?.ok === false) {
                    cleanup()
                    reject(new Error(message.error?.message || `Discovery worker failed for ${payload.specFile}`))
                }
            })
            worker.on('error', (error) => {
                cleanup()
                reject(error)
            })
            worker.on('exit', (code) => {
                if (code && code !== 0) {
                    cleanup()
                    reject(new Error(`Discovery worker for ${payload.specFile} exited with code ${code}`))
                }
            })
        })
    }

    private _getRunnerId(cid: number): string {
        if (!this._rid[cid]) {
            this._rid[cid] = 0
        }
        return `${cid}-${this._rid[cid]++}`
    }

    private async _endHandler({ cid: rid, exitCode, specs, retries }: EndMessage): Promise<void> {
        const passed = this._isWatchModeHalted() || exitCode === 0
        const job = this._runningJobs.get(rid)
        const startedAt = this._jobStartTimes.get(rid)
        this._runningJobs.delete(rid)
        this._jobStartTimes.delete(rid)
        if (startedAt !== undefined) {
            log.debug(`[perf] worker ${rid} finished in ${Date.now() - startedAt}ms exitCode=${exitCode} retries=${retries}`)
        }

        if (!passed && retries > 0) {
            const requeue = this.configParser.getConfig().specFileRetriesDeferred ? 'push' : 'unshift'
            const cid = parseInt(rid, 10)
            this._schedule[cid].specs[requeue](job
                ? { ...job, retries: retries - 1, rid }
                : { files: specs, retries: retries - 1, rid, jobType: 'spec' })
        } else {
            this._exitCode = this._isWatchModeHalted() ? 0 : this._exitCode || exitCode
            this._runnerFailed += !passed ? 1 : 0
        }

        if (!this._isWatchModeHalted() && this.interface) {
            this.interface.emit('job:end', { cid: rid, passed, retries })
        }

        const cid = parseInt(rid, 10)
        this._schedule[cid].availableInstances++
        this._schedule[cid].runningInstances--

        log.info('Run onWorkerEnd hook')
        const config = this.configParser.getConfig()
        await runLauncherHook(config.onWorkerEnd, rid, exitCode, specs, retries)
            .catch((error) => this._workerHookError(error))
        await runServiceHook(this._launcher!, 'onWorkerEnd', rid, exitCode, specs, retries)
            .catch((error) => this._workerHookError(error))

        const shouldRunSpecs = this._runSpecs()
        const inWatchMode = this._isWatchMode && !this._hasTriggeredExitRoutine
        if (!shouldRunSpecs || inWatchMode) {
            if (inWatchMode) {
                this.interface?.finalise()
            }
            return
        }

        if (this._resolve) {
            this._resolve(passed ? this._exitCode : 1)
        }
    }

    private _exitHandler(callback?: (value: boolean) => void): void | Promise<void> {
        if (!callback || !this.runner || !this.interface) {
            return
        }

        if (this._hasTriggeredExitRoutine) {
            return callback(true)
        }

        this._hasTriggeredExitRoutine = true
        this.interface.sigintTrigger()
        return this.runner.shutdown().then(callback)
    }

    private _isWatchModeHalted(): boolean {
        return this._isWatchMode && this._hasTriggeredExitRoutine
    }
}
