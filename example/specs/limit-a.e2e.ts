import { expect } from 'expect-webdriverio'
import { scaledPause } from '../support/timing.js'

describe('global limit a', () => {
    it('limit a test 1', async () => {
        await scaledPause(2500)
        await expect(true).toBe(true)
    })

    it('limit a test 2', async () => {
        await scaledPause(2500)
        await expect(true).toBe(true)
    })
})
