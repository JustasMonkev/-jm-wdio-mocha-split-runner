import { createChromeExampleConfig } from './support/config.js'

export const config: WebdriverIO.Config = createChromeExampleConfig({
    specs: ['./specs/alpha.e2e.ts', './specs/mixed.e2e.ts'],
    maxInstances: 2,
    parallelizeTests: {
        enabled: true,
        include: ['**/mixed.e2e.ts'],
        maxTestsPerFile: 5
    }
})
