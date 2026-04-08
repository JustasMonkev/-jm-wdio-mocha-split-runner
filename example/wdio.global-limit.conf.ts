import { createChromeExampleConfig } from './support/config.js'

export const config: WebdriverIO.Config = createChromeExampleConfig({
    specs: ['./specs/limit-a.e2e.ts', './specs/limit-b.e2e.ts'],
    maxInstances: 4,
    parallelizeTests: {
        enabled: true,
        include: ['**/limit-a.e2e.ts', '**/limit-b.e2e.ts'],
        maxTestsPerFile: 2,
        maxSplitInstances: 2
    }
})
