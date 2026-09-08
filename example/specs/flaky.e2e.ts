import { failOnce } from '../support/flaky.js'
import { scaledPause } from '../support/timing.js'

describe('retry file', () => {
    it('stable test', async () => {
        await scaledPause(500)
    })

    it('flaky test', async () => {
        await scaledPause(500)
        failOnce('flaky-test')
    })
})
