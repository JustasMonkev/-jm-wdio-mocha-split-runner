import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import logger from '@wdio/logger'

import ParallelLauncher from '../src/launcher.js'

function getMockPath(modulePath: string) {
    return path.join(fileURLToPath(new URL('../../webdriverio/__mocks__/', import.meta.url)), modulePath)
}

const caps: WebdriverIO.Capabilities = {
    browserName: 'chrome',
    'wdio:maxInstances': 2
}

vi.mock('node:fs/promises', () => ({
    default: {
        access: vi.fn().mockRejectedValue(new Error('ENOENT')),
        mkdir: vi.fn()
    }
}))
vi.mock('async-exit-hook', () => ({
    default: vi.fn()
}))
vi.mock('import-meta-resolve', () => ({
    resolve: vi.fn().mockReturnValue('/tmp/tsx.js')
}))
vi.mock('@wdio/cli', () => ({
    Launcher: class {
        run = vi.fn()
    }
}))
vi.mock('@wdio/utils', () => import(getMockPath('@wdio/utils')))
vi.mock('@wdio/utils/node', () => ({
    setupDriver: vi.fn(),
    setupBrowser: vi.fn()
}))
vi.mock('@wdio/config', () => import(getMockPath('@wdio/config')))
vi.mock('@wdio/config/node', () => import(getMockPath('@wdio/config/node')))
vi.mock('@wdio/logger', () => import(getMockPath('@wdio/logger')))
vi.mock('../src/cli/interface', () => ({
    default: class {
        totalWorkerCnt: number
        hasAnsiSupport = true
        emit = vi.fn()
        on = vi.fn()
        sigintTrigger = vi.fn()
        onMessage = vi.fn()
        logHookError = vi.fn()
        finalise = vi.fn()

        constructor (_config: WebdriverIO.Config, totalWorkerCnt: number) {
            this.totalWorkerCnt = totalWorkerCnt
        }
    }
}))

describe('ParallelLauncher', () => {
    let launcher: ParallelLauncher

    beforeEach(() => {
        launcher = new ParallelLauncher('./')
        launcher.interface = {
            emit: vi.fn(),
            on: vi.fn(),
            onMessage: vi.fn(),
            sigintTrigger: vi.fn(),
            finalise: vi.fn()
        } as any
    })

    it('rejects Mocha retries when split mode is enabled', async () => {
        await expect(
            launcher['_runMode']({
                specs: ['./a.js'],
                shard: { current: 1, total: 1 },
                maxInstances: 2,
                runner: 'local',
                runnerEnv: {},
                outputDir: './tmp',
                parallelizeTests: { enabled: true },
                mochaOpts: { retries: 1 }
            } as any, [caps])
        ).rejects.toThrow('`mochaOpts.retries` must be 0')
    })

    it('rejects invalid maxSplitInstances values', async () => {
        await expect(
            launcher['_runMode']({
                specs: ['./a.js'],
                shard: { current: 1, total: 1 },
                maxInstances: 2,
                runner: 'local',
                runnerEnv: {},
                outputDir: './tmp',
                framework: 'mocha',
                parallelizeTests: { enabled: true, maxSplitInstances: 0 },
                mochaOpts: { retries: 0 }
            } as any, [caps])
        ).rejects.toThrow('`parallelizeTests.maxSplitInstances` must be an integer greater than 0 when set')
    })

    it('keeps stock formatting behavior when split mode is disabled', () => {
        launcher.configParser.getSpecs = vi.fn().mockReturnValue(['/a.js', ['/b.js', '/c.js']])
        const formatted = launcher['_formatSpecs']({ specs: ['/a.js', ['/b.js', '/c.js']] } as any, 2)
        expect(formatted).toEqual([
            { files: ['/a.js'], retries: 2, jobType: 'spec' },
            { files: ['/b.js', '/c.js'], retries: 2, jobType: 'spec' }
        ])
    })

    it('provides a dedicated discovery seam for single-file specs', async () => {
        const specs = [{ files: ['/a.js'], retries: 3 }, { files: ['/b.js', '/c.js'], retries: 3 }] as any
        const discoverSpy = vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'suite test 2#0', fullTitle: 'suite test 2', suitePath: ['suite'], file: '/a.js' }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs'](specs, caps, 3, {
            parallelizeTests: { enabled: true },
            maxInstances: 4
        } as any)

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
        vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [],
            fallbackToSpecLevel: true,
            discoveryWarnings: ['fallback']
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 1 }] as any, caps, 1, {
            parallelizeTests: { enabled: true }
        } as any)

        expect(logger('@jm/wdio-mocha-split-runner').warn).toHaveBeenCalledWith(expect.stringContaining('fallback'))
        expect(expanded).toEqual([{ files: ['/a.js'], retries: 1 }])
    })

    it('prefers parallelizeTests.retries for split jobs when configured', async () => {
        vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'suite test 1#0', fullTitle: 'suite test 1', suitePath: ['suite'], file: '/a.js', retries: 0 }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 3 }] as any, caps, 3, {
            parallelizeTests: { enabled: true, retries: 2 }
        } as any)

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

    it('does not split by test title patterns anymore', async () => {
        vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
            specFile: '/a.js',
            manifestHash: 'hash',
            tests: [
                { selectorId: 'alpha 1#0', fullTitle: 'suite alpha 1', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'alpha 2#0', fullTitle: 'suite alpha 2', suitePath: ['suite'], file: '/a.js' },
                { selectorId: 'beta 1#0', fullTitle: 'suite beta 1', suitePath: ['suite'], file: '/a.js' }
            ],
            fallbackToSpecLevel: false
        })

        const expanded = await launcher['_expandSplitSpecs']([{ files: ['/a.js'], retries: 2, jobType: 'spec' }] as any, caps, 2, {
            parallelizeTests: { enabled: true, tests: ['alpha'] },
            maxInstances: 2
        } as any)

        expect(expanded).toEqual([{ files: ['/a.js'], retries: 2, jobType: 'spec' }])
    })

    it('matches tests by file path patterns only', async () => {
        vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
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
        }] as any, caps, 2, {
            parallelizeTests: { enabled: true, tests: ['**/alpha.e2e.ts'] },
            maxInstances: 2
        } as any)

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
        const discoverSpy = vi.spyOn(launcher as any, '_discoverSpecsForFile').mockResolvedValue({
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
        }] as any, caps, 2, {
            parallelizeTests: {
                enabled: true,
                include: ['**/alpha.e2e.ts'],
                tests: ['**/alpha.e2e.ts']
            },
            maxInstances: 2
        } as any)

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
        }] as any
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
        }] as any
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
        }] as any
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
        }] as any
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
        }] as any
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
