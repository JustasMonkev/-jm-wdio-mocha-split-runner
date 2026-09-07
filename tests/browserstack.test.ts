import { describe, expect, it } from 'vitest'

import {
    getDiscoveryIgnoredWorkerServices,
    getDiscoveryLauncherServices,
    getDiscoveryServices,
    hasBrowserstackService,
    isBrowserstackService
} from '../src/browserstack.js'

describe('BrowserStack discovery helpers', () => {
    it('detects BrowserStack service entries in string and tuple form', () => {
        expect(isBrowserstackService('browserstack')).toBe(true)
        expect(isBrowserstackService('@wdio/browserstack-service')).toBe(true)
        expect(isBrowserstackService(['browserstack', { testReporting: true }])).toBe(true)
        expect(isBrowserstackService(['@wdio/browserstack-service', { testReporting: true }])).toBe(true)
        expect(isBrowserstackService('foobar')).toBe(false)
    })

    it('detects BrowserStack class and instance service entries', () => {
        class BrowserstackService { beforeSession() {} }
        class CustomService { beforeSession() {} }

        expect(isBrowserstackService(BrowserstackService)).toBe(true)
        expect(isBrowserstackService([
            BrowserstackService,
            { testReporting: true }
        ])).toBe(true)
        expect(isBrowserstackService(new BrowserstackService())).toBe(true)
        expect(isBrowserstackService(CustomService)).toBe(false)
    })

    it('removes only BrowserStack services during discovery', () => {
        const serviceObject = { beforeSession() {} }
        class BrowserstackService { beforeSession() {} }
        const services: NonNullable<WebdriverIO.Config['services']> = [
            'browserstack',
            ['@wdio/browserstack-service', { testReporting: true }],
            [BrowserstackService, { testReporting: true }],
            'foobar',
            ['custom-service', { enabled: true }],
            serviceObject
        ]

        expect(getDiscoveryServices(services)).toEqual([
            'foobar',
            ['custom-service', { enabled: true }],
            serviceObject
        ])
    })

    it('detects when BrowserStack is configured', () => {
        const services: NonNullable<WebdriverIO.Config['services']> = [
            'browserstack',
            ['custom-service', { enabled: true }]
        ]

        expect(hasBrowserstackService(services)).toBe(true)
        expect(hasBrowserstackService([['custom-service', { enabled: true }]])).toBe(false)
    })

    it('adds BrowserStack services to ignored discovery worker services', () => {
        class BrowserstackService { beforeSession() {} }
        const services: NonNullable<WebdriverIO.Config['services']> = [
            'browserstack',
            ['custom-service', { enabled: true }],
            '@wdio/browserstack-service',
            BrowserstackService
        ]

        expect(getDiscoveryIgnoredWorkerServices(services, ['already-ignored'])).toEqual([
            'already-ignored',
            'browserstack',
            '@wdio/browserstack-service',
            'BrowserstackService'
        ])
    })

    it('removes only BrowserStack launcher instances during discovery', () => {
        class BrowserstackLauncherService { onPrepare() {} }
        class PercyLauncherService { onPrepare() {} }

        const browserstackLauncher = new BrowserstackLauncherService()
        const percyLauncher = new PercyLauncherService()

        expect(getDiscoveryLauncherServices([
            browserstackLauncher,
            percyLauncher
        ], ['browserstack'])).toEqual([percyLauncher])
        expect(getDiscoveryLauncherServices([
            browserstackLauncher,
            percyLauncher
        ], ['custom-service'])).toEqual([
            browserstackLauncher,
            percyLauncher
        ])
    })
})
