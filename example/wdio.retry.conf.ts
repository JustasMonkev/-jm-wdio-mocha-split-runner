import { createChromeExampleConfig } from './support/config.js'

export const config: WebdriverIO.Config = createChromeExampleConfig({
    specs: ['./specs/flaky.e2e.ts'],
    maxInstances: 2,
    parallelizeTests: {
        enabled: true,
        include: ['**/flaky.e2e.ts'],
        maxTestsPerFile: 2,
        retries: 1
    }
})
