import fs from 'node:fs'
import path from 'node:path'

function sanitizeMarkerName(name: string) {
    return name.replace(/[^a-zA-Z0-9_-]+/g, '_')
}

export function failOnce(markerName: string) {
    const flakyDir = process.env.PARALLEL_FLAKE_DIR
    if (!flakyDir) {
        throw new Error('PARALLEL_FLAKE_DIR must be set for the retry example')
    }

    fs.mkdirSync(flakyDir, { recursive: true })
    const markerPath = path.join(flakyDir, `${sanitizeMarkerName(markerName)}.marker`)

    if (!fs.existsSync(markerPath)) {
        fs.writeFileSync(markerPath, '1')
        throw new Error(`Intentional flaky failure for ${markerName}`)
    }
}
