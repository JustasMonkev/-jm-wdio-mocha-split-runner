import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggerInfo = vi.fn()

function style(tag: string) {
    return (value: unknown) => `<${tag}>${String(value)}</${tag}>`
}

const chalkMock = {
    bold: style('bold'),
    blue: style('blue'),
    bgYellow: style('bgYellow'),
    black: style('black'),
    cyan: style('cyan'),
    yellow: style('yellow'),
    green: style('green'),
    red: style('red'),
    white: style('white'),
    bgRed: style('bgRed'),
    magenta: style('magenta'),
    gray: style('gray')
}

const mixedSpecPath = `${process.cwd()}/example/specs/mixed.e2e.ts`
const alphaSpecPath = `${process.cwd()}/example/specs/alpha.e2e.ts`

vi.mock('chalk', () => ({
    default: chalkMock,
    supportsColor: { hasBasic: true }
}))

vi.mock('@wdio/logger', () => ({
    default: vi.fn(() => ({
        info: loggerInfo,
        error: vi.fn(),
        debug: vi.fn()
    }))
}))

const { default: WDIOCLInterface } = await import('../src/cli/interface.js')

describe('WDIOCLInterface', () => {
    beforeEach(() => {
        loggerInfo.mockReset()
    })

    it('renders colored start output for shard, debug, and watch mode', () => {
        const cli = new WDIOCLInterface({
            shard: { current: 2, total: 3 }
        } as WebdriverIO.Config, 4, true)
        const logSpy = vi.spyOn(cli, 'log')

        cli.onMessage({
            origin: 'debugger',
            name: 'start',
            params: { introMessage: 'Debugger attached' }
        } as any)
        cli.onStart()

        expect(logSpy).toHaveBeenCalledWith('<yellow>Debugger attached</yellow>')
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('<bold>\nExecution of <blue>4</blue> workers (Shard 2 of 3) started at</bold>'),
            expect.any(String)
        )
        expect(logSpy).toHaveBeenCalledWith('<bgYellow><black>DEBUG mode enabled!</black></bgYellow>')
        expect(logSpy).toHaveBeenCalledWith('<bgYellow><black>WATCH mode enabled!</black></bgYellow>')
    })

    it('renders colored status lines for running, retry, and pass', () => {
        const cli = new WDIOCLInterface({
            specFileRetries: 2,
            specFileRetriesDelay: 3
        } as WebdriverIO.Config, 1)
        const logSpy = vi.spyOn(cli, 'log')
        const job = {
            caps: {
                browserName: 'chrome',
                browserVersion: '146',
                platformName: 'macOS'
            },
            specs: [mixedSpecPath],
            hasTests: true
        }

        cli.addJob({ cid: '0-0', ...job } as any)
        cli.clearJob({ cid: '0-0', passed: false, retries: 1 })
        cli.addJob({ cid: '0-0', ...job } as any)
        cli.clearJob({ cid: '0-0', passed: true, retries: 0 })

        expect(logSpy).toHaveBeenCalledWith(
            '[0-0]',
            '<bold><cyan>RUNNING</cyan></bold>',
            'in',
            'chrome(146)',
            'on',
            'macOS',
            '- /example/specs/mixed.e2e.ts'
        )
        expect(logSpy).toHaveBeenCalledWith(
            '[0-0]',
            '<bold><yellow>RETRYING</yellow> after 3s</bold>',
            'in',
            'chrome(146)',
            'on',
            'macOS',
            '- /example/specs/mixed.e2e.ts',
            '(1 retries)'
        )
        expect(logSpy).toHaveBeenCalledWith(
            '[0-0]',
            '<bold><green>PASSED</green></bold>',
            'in',
            'chrome(146)',
            'on',
            'macOS',
            '- /example/specs/mixed.e2e.ts',
            '(2 retries)'
        )
    })

    it('renders colored summary and skip output', () => {
        const cli = new WDIOCLInterface({} as WebdriverIO.Config, 3)
        const logSpy = vi.spyOn(cli, 'log')

        ;(cli as any)._skippedSpecs = 1
        cli.result = {
            finished: 2,
            passed: 1,
            retries: 1,
            failed: 1
        }
        cli.totalWorkerCnt = 4

        cli.onSpecSkip('0-1', {
            caps: { browserName: 'chrome' },
            specs: [alphaSpecPath],
            hasTests: false
        } as any)
        cli.printSummary()

        expect(loggerInfo).toHaveBeenCalledWith(
            '[0-1]',
            'SKIPPED',
            'in',
            'chrome',
            '- /example/specs/alpha.e2e.ts'
        )
        expect(logSpy).toHaveBeenCalledWith(
            '\nSpec Files:\t',
            '<green>1</green> passed, <yellow>1</yellow> retries, <red>1</red> failed, <gray>1</gray> skipped, 3 total',
            '(67% completed)',
            'in',
            expect.any(String),
            '',
            '\n'
        )
    })

    it('renders colored test errors', () => {
        const cli = new WDIOCLInterface({} as WebdriverIO.Config, 1)
        const logSpy = vi.spyOn(cli, 'log')

        cli.onTestError({
            cid: '0-0',
            fullTitle: 'suite flaky test',
            error: {
                type: 'AssertionError',
                message: 'boom'
            }
        } as any)

        expect(logSpy).toHaveBeenCalledWith(
            '[0-0]',
            '<red>AssertionError</red> in "suite flaky test"\n<red>boom</red>'
        )
    })
})
