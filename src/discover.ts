import process from 'node:process'

import logger from '@wdio/logger'
import { ConfigParser } from '@wdio/config/node'
import { initializeWorkerService, executeHooksWithArgs } from '@wdio/utils'

import { buildManifest, createMochaRuntime } from './framework.js'
import { classifyDiscoveryError } from './mocha/parallel.js'
import type { ParallelDiscoveryPayload, ParallelDiscoveryResponse, ParallelRuntimeConfig } from './types.js'
import { initializeStubSession } from './stub-session.js'
import { getDiscoveryIgnoredWorkerServices, getDiscoveryServices } from './browserstack.js'

const log = logger('@jm/wdio-mocha-split-runner:discover')

process.on('message', async (payload: ParallelDiscoveryPayload) => {
    if (!payload || typeof payload !== 'object') {
        process.exit(1)
        return
    }

    try {
        const parser = new ConfigParser(payload.configFile, payload.args)
        await parser.initialize(payload.args)
        // SAFETY: ConfigParser normalizes rootDir; discovery is launched only for the configured Mocha framework.
        const config = parser.getConfig() as ParallelRuntimeConfig
        logger.setLogLevelsConfig(config.logLevels, config.logLevel)

        const discoveryConfig = {
            ...config,
            services: getDiscoveryServices(config.services || [])
        }
        const services = await initializeWorkerService(
            discoveryConfig,
            payload.caps,
            getDiscoveryIgnoredWorkerServices(config.services || [], payload.args.ignoredWorkerServices)
        )
        services.forEach(parser.addService.bind(parser))

        await initializeStubSession(config, payload.caps)

        await executeHooksWithArgs('beforeSession', config.beforeSession, [config, payload.caps, [payload.specFile], payload.cid])

        const mocha = await createMochaRuntime(payload.cid, config, [payload.specFile])
        const manifest = buildManifest(mocha, payload.specFile, config.mochaOpts)
        process.send?.({ ok: true, manifest } satisfies ParallelDiscoveryResponse)
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
            } satisfies ParallelDiscoveryResponse)
            process.exit(0)
            return
        }

        log.error(error.stack || error.message)
        process.send?.({ ok: false, error: { message: error.message, stack: error.stack } } satisfies ParallelDiscoveryResponse)
        process.exit(1)
    }
})

if (typeof process.send === 'function') {
    process.send({ ok: true, ready: true } satisfies ParallelDiscoveryResponse)
}
