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
        class BrowserstackService {}
        class CustomService {}

        expect(isBrowserstackService(BrowserstackService as unknown as WebdriverIO.ServiceClass)).toBe(true)
        expect(isBrowserstackService([
            BrowserstackService as unknown as WebdriverIO.ServiceClass,
            { testReporting: true }
        ])).toBe(true)
        expect(isBrowserstackService(new BrowserstackService() as unknown as WebdriverIO.ServiceClass)).toBe(true)
        expect(isBrowserstackService(CustomService as unknown as WebdriverIO.ServiceClass)).toBe(false)
    })

    it('removes only BrowserStack services during discovery', () => {
        const serviceObject = { beforeSession() {} }
        class BrowserstackService {}
        const services = [
            'browserstack',
            ['@wdio/browserstack-service', { testReporting: true }],
            [BrowserstackService as unknown as WebdriverIO.ServiceClass, { testReporting: true }],
            'foobar',
            ['custom-service', { enabled: true }],
            serviceObject
        ] as WebdriverIO.Config['services']

        expect(getDiscoveryServices(services)).toEqual([
            'foobar',
            ['custom-service', { enabled: true }],
            serviceObject
        ])
    })

    it('detects when BrowserStack is configured', () => {
        const services = [
            'browserstack',
            ['custom-service', { enabled: true }]
        ] as WebdriverIO.Config['services']

        expect(hasBrowserstackService(services)).toBe(true)
        expect(hasBrowserstackService([['custom-service', { enabled: true }]])).toBe(false)
    })

    it('adds BrowserStack services to ignored discovery worker services', () => {
        class BrowserstackService {}
        const services = [
            'browserstack',
            ['custom-service', { enabled: true }],
            '@wdio/browserstack-service',
            BrowserstackService as unknown as WebdriverIO.ServiceClass
        ] as WebdriverIO.Config['services']

        expect(getDiscoveryIgnoredWorkerServices(services, ['already-ignored'])).toEqual([
            'already-ignored',
            'browserstack',
            '@wdio/browserstack-service',
            'BrowserstackService'
        ])
    })

    it('removes only BrowserStack launcher instances during discovery', () => {
        class BrowserstackLauncherService {}
        class PercyLauncherService {}

        const browserstackLauncher = new BrowserstackLauncherService()
        const percyLauncher = new PercyLauncherService()

        expect(getDiscoveryLauncherServices([
            browserstackLauncher as object,
            percyLauncher as object
        ] as any, ['browserstack'])).toEqual([percyLauncher])
        expect(getDiscoveryLauncherServices([
            browserstackLauncher as object,
            percyLauncher as object
        ] as any, ['custom-service'])).toEqual([
            browserstackLauncher,
            percyLauncher
        ])
    })
})
