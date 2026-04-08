import { appendTrace, setTraceRuntime } from './trace.js'

function getFullTitle(test: { fullTitle?: string | (() => string), title: string }) {
    if (typeof test.fullTitle === 'function') {
        return test.fullTitle()
    }

    return test.fullTitle || test.title
}

export function createChromeExampleConfig(overrides: Partial<WebdriverIO.Config> = {}): WebdriverIO.Config {
    const baseConfig: WebdriverIO.Config = {
        runner: 'local',
        framework: 'mocha',
        specs: ['./specs/*.e2e.ts'],
        maxInstances: 2,
        logLevel: (process.env.WDIO_LOG_LEVEL as WebdriverIO.Config['logLevel']) || 'warn',
        mochaOpts: {
            ui: 'bdd',
            timeout: 60000
        },
        capabilities: [{
            browserName: 'chrome',
            'goog:chromeOptions': {
                args: ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
            }
        }],
        beforeSession(config, _caps, specs, cid) {
            setTraceRuntime({
                cid,
                specs,
                parallelizeTestsContext: config.parallelizeTestsContext
            })
            appendTrace({ event: 'session:start' })
        },
        beforeTest(test) {
            appendTrace({
                event: 'test:start',
                title: test.title,
                fullTitle: getFullTitle(test),
                testFile: (test as { file?: string }).file || null
            })
        },
        afterTest(test, _context, result) {
            appendTrace({
                event: 'test:end',
                title: test.title,
                fullTitle: getFullTitle(test),
                testFile: (test as { file?: string }).file || null,
                passed: result.passed
            })
        },
        afterSession() {
            appendTrace({ event: 'session:end' })
        }
    }

    return {
        ...baseConfig,
        ...overrides,
        mochaOpts: {
            ...baseConfig.mochaOpts,
            ...overrides.mochaOpts
        },
        capabilities: overrides.capabilities || baseConfig.capabilities
    }
}
