import { createChromeExampleConfig } from './support/config.js'

export const config: WebdriverIO.Config = createChromeExampleConfig({
    specs: ['./specs/mixed.e2e.ts'],
    maxInstances: 2,
    parallelizeTests: {
        enabled: true,
        include: ['**/mixed.e2e.ts'],
        batchSize: 2,
        maxTestsPerFile: 2
    }
})
