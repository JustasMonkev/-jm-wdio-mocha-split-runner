import { describe, expect, it } from 'vitest'
import { sanitizeCaps } from '../src/stub-session.js'

const capabilities = {
    browserName: 'chrome',
    acceptInsecureCerts: false,
    'wdio:maxInstances': 0,
    hostname: 'localhost',
    logLevel: 'error'
}

describe('sanitizeCaps', () => {
    it.each([capabilities, { alwaysMatch: capabilities, firstMatch: [{}] }])(
        'separates connection options while preserving explicit false and zero values',
        (input) => {
            expect(sanitizeCaps(input)).toEqual({
                browserName: 'chrome',
                acceptInsecureCerts: false,
                'wdio:maxInstances': 0
            })
            expect(sanitizeCaps(input, true)).toEqual({ hostname: 'localhost', logLevel: 'error' })
            expect(sanitizeCaps(input, false)).toEqual(sanitizeCaps(input))
        }
    )
})
