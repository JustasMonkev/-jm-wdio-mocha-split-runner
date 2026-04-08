import { expect } from 'expect-webdriverio'
import { failOnce } from '../support/flaky.js'
import { scaledPause } from '../support/timing.js'

describe('retry file', () => {
    it('stable test', async () => {
        await scaledPause(500)
        await expect(true).toBe(true)
    })

    it('flaky test', async () => {
        await scaledPause(500)
        failOnce('flaky-test')
        await expect(true).toBe(true)
    })
})
