import { scaledPause } from '../support/timing.js'

describe('mixed file', () => {
    it('alpha test 1', async () => {
        await scaledPause(3000)
    })

    it('alpha test 2', async () => {
        await scaledPause(8000)
    })

    it('alpha test 3', async () => {
        await scaledPause(2000)
    })

    it('alpha test 4', async () => {
        await scaledPause(1000)
    })
})
