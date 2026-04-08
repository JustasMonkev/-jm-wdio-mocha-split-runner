import { driver } from '@wdio/globals'

export async function scaledPause(ms: number) {
    const scale = Number(process.env.PARALLEL_DELAY_SCALE ?? '1')
    const scaled = Math.max(0, Math.round(ms * scale))

    if (scaled > 0) {
        await driver.pause(scaled)
    }
}
