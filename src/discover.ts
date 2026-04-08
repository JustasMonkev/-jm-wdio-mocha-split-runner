import process from 'node:process'

import { _setGlobal } from '@wdio/globals'
import logger from '@wdio/logger'
import { ConfigParser } from '@wdio/config/node'
import { initializeWorkerService, executeHooksWithArgs } from '@wdio/utils'
import { expect, setOptions, matchers, getConfig } from 'expect-webdriverio'

import { buildManifest, createMochaRuntime } from './framework.js'
import { classifyDiscoveryError } from './mocha/parallel.js'
import type { ParallelDiscoveryPayload, ParallelRuntimeConfig } from './types.js'
import { initializeStubSession } from './stub-session.js'

const log = logger('@jm/wdio-mocha-split-runner:discover')

process.on('message', async (payload: ParallelDiscoveryPayload) => {
    if (!payload || typeof payload !== 'object') {
        process.exit(1)
        return
    }

    try {
        const parser = new ConfigParser(payload.configFile, payload.args)
        await parser.initialize(payload.args)
        const config = parser.getConfig() as ParallelRuntimeConfig
        logger.setLogLevelsConfig(config.logLevels, config.logLevel)

        const services = await initializeWorkerService(config, payload.caps, payload.args.ignoredWorkerServices)
        services.forEach(parser.addService.bind(parser))

        const browser = await initializeStubSession(config, payload.caps)
        _setGlobal('browser', browser, config.injectGlobals)
        _setGlobal('driver', browser, config.injectGlobals)
        _setGlobal('expect', expect, config.injectGlobals)

        setOptions({
            wait: config.waitforTimeout,
            interval: config.waitforInterval,
            beforeAssertion: async () => {},
            afterAssertion: async () => {}
        })

        await executeHooksWithArgs('beforeSession', config.beforeSession, [config, payload.caps, [payload.specFile], payload.cid])

        const mocha = await createMochaRuntime(payload.cid, config, [payload.specFile])
        const manifest = buildManifest(mocha, payload.specFile, config.mochaOpts)
        process.send?.({ ok: true, manifest })
        process.exit(0)
    } catch (err) {
        const error = err as Error
        const classification = classifyDiscoveryError(error)
        if (classification === 'fallback') {
            process.send?.({
                ok: true,
                manifest: {
                    specFile: payload.specFile,
                    tests: [],
                    manifestHash: '',
                    fallbackToSpecLevel: true,
                    discoveryWarnings: [error.message]
                }
            })
            process.exit(0)
            return
        }

        log.error(error.stack || error.message)
        process.send?.({ ok: false, error: { message: error.message, stack: error.stack } })
        process.exit(1)
    }
})

if (typeof process.send === 'function') {
    process.send({ ok: true, ready: true })
}
