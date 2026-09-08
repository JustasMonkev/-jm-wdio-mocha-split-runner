import { scaledPause } from '../support/timing.js'

describe('global limit b', () => {
    it('limit b test 1', async () => {
        await scaledPause(2500)
    })

    it('limit b test 2', async () => {
        await scaledPause(2500)
    })
})
