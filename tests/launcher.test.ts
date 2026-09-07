import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import logger from '@wdio/logger'

import ParallelLauncher from '../src/launcher.js'
import WDIOCLInterface from '../src/cli/interface.js'

const caps: WebdriverIO.Capabilities = {
    browserName: 'chrome',
    'wdio:maxInstances': 2
}

describe('ParallelLauncher', () => {
    let launcher: ParallelLauncher

    function runtimeConfig(overrides: Partial<WebdriverIO.Config>) {
        return { ...launcher.configParser.getConfig(), ...overrides }
    }

    beforeEach(async () => {
        vi.restoreAllMocks()
        launcher = new ParallelLauncher(fileURLToPath(new URL('./fixtures/wdio.conf.mjs', import.meta.url)))
        await launcher.configParser.initialize()
        launcher.interface = new WDIOCLInterface({ capabilities: [] }, 0)
        vi.spyOn(logger('@jm/wdio-mocha-split-runner'), 'warn').mockImplementation(() => {})
        vi.spyOn(logger('@jm/wdio-mocha-split-runner'), 'debug').mockImplementation(() => {})
    })

    it('rejects Mocha retries when split mode is enabled', async () => {
        await expect(
            launcher['_runMode'](runtimeConfig({
                specs: ['./a.js'],
                shard: { current: 1, total: 1 },
                maxInstances: 2,
                runner: 'local',
                runnerEnv: {},
                outputDir: './tmp',
                parallelizeTests: { enabled: true },
                mochaOpts: { retries: 1 }
            }), [caps])
        ).rejects.toThrow('`mochaOpts.retries` must be 0')
    })

    it('rejects invalid maxSplitInstances values', async () => {
        await expect(
            launcher['_runMode'](runtimeConfig({
                specs: ['./a.js'],
                shard: { current: 1, total: 1 },
                maxInstances: 2,
                runner: 'local',
                runnerEnv: {},
                outputDir: './tmp',
                framework: 'mocha',
                parallelizeTests: { enabled: true, maxSplitInstances: 0 },
                mochaOpts: { retries: 0 }
            }), [caps])
        ).rejects.toThrow('`parallelizeTests.maxSplitInstances` must be an integer greater than 0 when set')
    })

    it('rejects invalid batchSize values', async () => {
        await expect(
            launcher['_runMode'](runtimeConfig({
                specs: ['./a.js'],
                shard: { current: 1, total: 1 },
                maxInstances: 2,
                runner: 'local',
                runnerEnv: {},
                outputDir: './tmp',
                framework: 'mocha',
                parallelizeTests: { enabled: true, batchSize: 0 },
                mochaOpts: { retries: 0 }
            }), [caps])
        ).rejects.toThrow('`parallelizeTests.batchSize` must be an integer greater than 0 when set')
    })

    it('keeps stock formatting behavior when split mode is disabled', () => {
        launcher.configParser.getSpecs = vi.fn().mockReturnValue(['/a.js', ['/b.js', '/c.js']])
        const capabilities = { ...caps, specs: ['/a.js', ['/b.js', '/c.js']] }
        const formatted = launcher['_formatSpecs'](capabilities, 2)
        expect(formatted).toEqual([
            { files: ['/a.js'], retries: 2, jobType: 'spec' },
            { files: ['/b.js', '/c.js'], retries: 2, jobType: 'spec' }
        ])
    })

    it('provides a dedicated discovery seam for single-file specs', async () => {
        const specs = [{ files: ['/a.js'], retries: 3 }, { files: ['/b.js', '/c.js'], retries: 3 }]
        const discoverSpy = launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'suite test 2#0', fullTitle: 'suite test 2', suitePath: ['suite'], file: '/a.js' }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs'](specs, caps, 3, runtimeConfig({
            parallelizeTests: { enabled: true },
            maxInstances: 4
        }))

        expect(discoverSpy).toHaveBeenCalledWith('/a.js', caps)
        expect(expanded).toEqual([
            {
                files: ['/a.js'],
                retries: 3,
                jobType: 'test',
                specFile: '/a.js',
                selectorId: 'suite test 1#0',
                manifestHash: 'hash'
            },
            {
                files: ['/a.js'],
                retries: 3,
                jobType: 'test',
                specFile: '/a.js',
                selectorId: 'suite test 2#0',
                manifestHash: 'hash'
            },
            {
                files: ['/b.js', '/c.js'],
                retries: 3
            }
        ])
    })

    it('falls back to spec-level execution when discovery requests fallback', async () => {
        launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [],
            fallbackToSpecLevel: true,
            discoveryWarnings: ['fallback']
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 1 }], caps, 1, runtimeConfig({
            parallelizeTests: { enabled: true }
        }))

        expect(logger('@jm/wdio-mocha-split-runner').warn).toHaveBeenCalledWith(expect.stringContaining('fallback'))
        expect(expanded).toEqual([{ files: ['/a.js'], retries: 1 }])
    })

    it('prefers parallelizeTests.retries for split jobs when configured', async () => {
        launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js', retries: 0 }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 3 }], caps, 3, runtimeConfig({
            parallelizeTests: { enabled: true, retries: 2 }
        }))

        expect(expanded).toEqual([
            {
                files: ['/a.js'],
                retries: 2,
                jobType: 'test',
                specFile: '/a.js',
                selectorId: 'suite test 1#0',
                manifestHash: 'hash'
            }
        ])
    })

    it('groups split candidates into subset shard jobs when batchSize is greater than one', async () => {
        launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js', retries: 0 },
                { selectorId: 'suite test 2#0', fullTitle: 'suite test 2', suitePath: ['suite'], file: '/a.js', retries: 1 },
                { selectorId: 'suite test 3#0', fullTitle: 'suite test 3', suitePath: ['suite'], file: '/a.js', retries: 0 }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 3, jobType: 'spec' }], caps, 3, runtimeConfig({
            parallelizeTests: { enabled: true, batchSize: 2 },
            maxInstances: 4
        }))

        expect(expanded).toEqual([
            {
                files: ['/a.js'],
                retries: 3,
                jobType: 'subset',
                specFile: '/a.js',
                selectorIds: ['suite test 1#0', 'suite test 2#0'],
                manifestHash: 'hash'
            },
            {
                files: ['/a.js'],
                retries: 0,
                jobType: 'test',
                specFile: '/a.js',
                selectorId: 'suite test 3#0',
                manifestHash: 'hash'
            }
        ])
    })

    it('logs discovery phase timing after manifest discovery', async () => {
        launcher['_runDiscoveryWorker'] = vi.fn<ParallelLauncher['_runDiscoveryWorker']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js' }
            ],
            fallbackToSpecLevel: false
        })
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            services: [],
            execArgv: [],
            onWorkerStart: [],
            logLevel: 'debug',
            logLevels: {}
        })

        const manifest = await launcher['_discoverSpecsForFile']('/a.js', caps)

        expect(manifest.tests).toHaveLength(1)
        expect(logger('@jm/wdio-mocha-split-runner').debug).toHaveBeenCalledWith(
            expect.stringMatching(/\[perf\] discovery for \/a\.js completed in \d+ms \(1 tests\)/)
        )
    })

    it('logs worker startup timing when a job starts', async () => {
        const worker = Object.assign(new EventEmitter(), { logsAggregator: [] })
        launcher.runner = {
            run: vi.fn().mockReturnValue(worker),
            initialize: async () => {},
            shutdown: async () => true,
            getWorkerCount: () => 1,
            workerPool: {},
            browserPool: {}
        }
        launcher['_launcher'] = []
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            execArgv: [],
            onWorkerStart: [],
            groupLogsByTestSpec: false,
            runnerEnv: {},
            user: undefined,
            key: undefined
        })

        await launcher['_startInstance']({
            files: ['/a.js'],
            retries: 0,
            jobType: 'subset',
            specFile: '/a.js',
            selectorIds: ['one', 'two'],
            manifestHash: 'hash'
        }, caps, 0)

        expect(logger('@jm/wdio-mocha-split-runner').debug).toHaveBeenCalledWith(
            expect.stringMatching(/\[perf\] worker 0-0 started in \d+ms \(subset\)/)
        )
    })

    it('does not split by test title patterns anymore', async () => {
        launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'alpha 1#0', fullTitle: 'suite alpha 1', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'alpha 2#0', fullTitle: 'suite alpha 2', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'beta 1#0', fullTitle: 'suite beta 1', suitePath: ['suite'], file: '/a.js' }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 2, jobType: 'spec' }], caps, 2, runtimeConfig({
            parallelizeTests: { enabled: true, tests: ['alpha'] },
            maxInstances: 2
        }))

        expect(expanded).toEqual([{ files: ['/a.js'], retries: 2, jobType: 'spec' }])
    })

    it('matches tests by file path patterns only', async () => {
        launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: 'file:///Users/test/project/specs/alpha.e2e.ts',
            manifestHash: 'hash',
            tests: [
                {
                    selectorId: 'alpha 1#0',
                    fullTitle: 'suite alpha 1',
                    suitePath: ['suite'],
                    file: '/Users/test/project/specs/alpha.e2e.ts'
                },
                {
                    selectorId: 'beta 1#0',
                    fullTitle: 'suite beta 1',
                    suitePath: ['suite'],
                    file: '/Users/test/project/specs/alpha.e2e.ts'
                }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{
            files: ['file:///Users/test/project/specs/alpha.e2e.ts'],
            retries: 2,
            jobType: 'spec'
        }], caps, 2, runtimeConfig({
            parallelizeTests: { enabled: true, tests: ['**/alpha.e2e.ts'] },
            maxInstances: 2
        }))

        expect(expanded).toEqual([
            {
                files: ['file:///Users/test/project/specs/alpha.e2e.ts'],
                retries: 2,
                jobType: 'test',
                specFile: 'file:///Users/test/project/specs/alpha.e2e.ts',
                selectorId: 'alpha 1#0',
                manifestHash: 'hash'
            },
            {
                files: ['file:///Users/test/project/specs/alpha.e2e.ts'],
                retries: 2,
                jobType: 'test',
                specFile: 'file:///Users/test/project/specs/alpha.e2e.ts',
                selectorId: 'beta 1#0',
                manifestHash: 'hash'
            }
        ])
    })

    it('supports wildcard file matching for include and tests', async () => {
        const discoverSpy = launcher['_discoverSpecsForFile'] = vi.fn<ParallelLauncher['_discoverSpecsForFile']>().mockResolvedValue({
            specFile: 'file:///Users/test/project/specs/alpha.e2e.ts',
            manifestHash: 'hash',
            tests: [
                {
                    selectorId: 'alpha 1#0',
                    fullTitle: 'suite first',
                    suitePath: ['suite'],
                    file: '/Users/test/project/specs/alpha.e2e.ts'
                },
                {
                    selectorId: 'alpha 2#0',
                    fullTitle: 'suite second',
                    suitePath: ['suite'],
                    file: '/Users/test/project/specs/alpha.e2e.ts'
                }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{
            files: ['file:///Users/test/project/specs/alpha.e2e.ts'],
            retries: 2,
            jobType: 'spec'
        }], caps, 2, runtimeConfig({
            parallelizeTests: {
                enabled: true,
                include: ['**/alpha.e2e.ts'],
                tests: ['**/alpha.e2e.ts']
            },
            maxInstances: 2
        }))

        expect(discoverSpy).toHaveBeenCalled()
        expect(expanded).toHaveLength(2)
        expect(expanded.every((job) => job.jobType === 'test')).toBe(true)
    })

    it('respects maxTestsPerFile while still scheduling other eligible jobs', () => {
        launcher['_startInstance'] = vi.fn()
        launcher['_runningJobs'].set('0-0', {
            files: ['/a.js'],
            retries: 1,
            rid: '0-0',
            jobType: 'test',
            specFile: '/a.js',
            selectorId: 'suite test 1#0',
            manifestHash: 'hash'
        })
        launcher['_schedule'] = [{
            cid: 0,
            caps,
            specs: [
                { files: ['/a.js'], retries: 1, jobType: 'test', specFile: '/a.js', selectorId: 'suite test 2#0', manifestHash: 'hash' },
                { files: ['/b.js'], retries: 1, jobType: 'spec' }
            ],
            availableInstances: 2,
            runningInstances: 1
        }]
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            maxInstances: 5,
            parallelizeTests: { enabled: true, maxTestsPerFile: 1 },
            bail: 0
        })

        launcher['_runSpecs']()

        expect(launcher['_startInstance']).toHaveBeenCalledWith(
            { files: ['/b.js'], retries: 1, jobType: 'spec' },
            caps,
            0
        )
    })

    it('keeps split-job scheduling unchanged when maxSplitInstances is omitted', () => {
        launcher['_startInstance'] = vi.fn()
        launcher['_runningJobs'].set('0-0', {
            files: ['/a.js'],
            retries: 1,
            rid: '0-0',
            jobType: 'test',
            specFile: '/a.js',
            selectorId: 'suite test 1#0',
            manifestHash: 'hash-a'
        })
        launcher['_schedule'] = [{
            cid: 0,
            caps,
            specs: [
                { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 2#0', manifestHash: 'hash-b' }
            ],
            availableInstances: 2,
            runningInstances: 1
        }]
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            maxInstances: 5,
            parallelizeTests: { enabled: true, maxTestsPerFile: 1 },
            bail: 0
        })

        launcher['_runSpecs']()

        expect(launcher['_startInstance']).toHaveBeenCalledWith(
            { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 2#0', manifestHash: 'hash-b' },
            caps,
            0
        )
    })

    it('caps split jobs globally when maxSplitInstances is reached', () => {
        launcher['_startInstance'] = vi.fn()
        launcher['_runningJobs'].set('0-0', {
            files: ['/a.js'],
            retries: 1,
            rid: '0-0',
            jobType: 'test',
            specFile: '/a.js',
            selectorId: 'suite test 1#0',
            manifestHash: 'hash-a'
        })
        launcher['_schedule'] = [{
            cid: 0,
            caps,
            specs: [
                { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 2#0', manifestHash: 'hash-b' }
            ],
            availableInstances: 2,
            runningInstances: 1
        }]
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            maxInstances: 5,
            parallelizeTests: { enabled: true, maxTestsPerFile: 2, maxSplitInstances: 1 },
            bail: 0
        })

        launcher['_runSpecs']()

        expect(launcher['_startInstance']).not.toHaveBeenCalled()
    })

    it('allows spec jobs to run when the split-job cap is saturated', () => {
        launcher['_startInstance'] = vi.fn()
        launcher['_runningJobs'].set('0-0', {
            files: ['/a.js'],
            retries: 1,
            rid: '0-0',
            jobType: 'test',
            specFile: '/a.js',
            selectorId: 'suite test 1#0',
            manifestHash: 'hash'
        })
        launcher['_schedule'] = [{
            cid: 0,
            caps,
            specs: [
                { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 2#0', manifestHash: 'hash' },
                { files: ['/c.js'], retries: 1, jobType: 'spec' }
            ],
            availableInstances: 2,
            runningInstances: 1
        }]
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            maxInstances: 5,
            parallelizeTests: { enabled: true, maxTestsPerFile: 2, maxSplitInstances: 1 },
            bail: 0
        })

        launcher['_runSpecs']()

        expect(launcher['_startInstance']).toHaveBeenCalledWith(
            { files: ['/c.js'], retries: 1, jobType: 'spec' },
            caps,
            0
        )
    })

    it('applies per-file and global split caps together', () => {
        launcher['_startInstance'] = vi.fn()
        launcher['_runningJobs'].set('0-0', {
            files: ['/a.js'],
            retries: 1,
            rid: '0-0',
            jobType: 'test',
            specFile: '/a.js',
            selectorId: 'suite test 1#0',
            manifestHash: 'hash-a'
        })
        launcher['_schedule'] = [{
            cid: 0,
            caps,
            specs: [
                { files: ['/a.js'], retries: 1, jobType: 'test', specFile: '/a.js', selectorId: 'suite test 2#0', manifestHash: 'hash-a' },
                { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 1#0', manifestHash: 'hash-b' }
            ],
            availableInstances: 3,
            runningInstances: 1
        }]
        launcher.configParser.getConfig = vi.fn().mockReturnValue({
            maxInstances: 5,
            parallelizeTests: { enabled: true, maxTestsPerFile: 1, maxSplitInstances: 2 },
            bail: 0
        })

        launcher['_runSpecs']()

        expect(launcher['_startInstance']).toHaveBeenCalledWith(
            { files: ['/b.js'], retries: 1, jobType: 'test', specFile: '/b.js', selectorId: 'suite test 1#0', manifestHash: 'hash-b' },
            caps,
            0
        )
        expect(launcher['_startInstance']).not.toHaveBeenCalledWith(
            { files: ['/a.js'], retries: 1, jobType: 'test', specFile: '/a.js', selectorId: 'suite test 2#0', manifestHash: 'hash-a' },
            caps,
            0
        )
    })
})
