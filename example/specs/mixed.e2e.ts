import { expect } from 'expect-webdriverio'
import { scaledPause } from '../support/timing.js'

describe('mixed file', () => {
    it('alpha test 1', async () => {
        await scaledPause(3000)
        await expect(true).toBe(true)
    })

    it('alpha test 2', async () => {
        await scaledPause(8000)
        await expect(true).toBe(true)
    })

    it('alpha test 3', async () => {
        await scaledPause(2000)
        await expect(true).toBe(true)
    })

    it('alpha test 4', async () => {
        await scaledPause(1000)
        await expect(true).toBe(true)
    })
})
