import { _setGlobal } from '@wdio/globals'
import { expect, setOptions } from 'expect-webdriverio'
import type { Capabilities } from '@wdio/types'
import { DEFAULTS } from 'webdriver'
import { DEFAULT_CONFIGS } from '@wdio/config'
import { remote, multiremote } from 'webdriverio'
import { enableFileLogging } from '@wdio/utils'
import { deepmerge } from 'deepmerge-ts'

export function sanitizeCaps(
    capabilities: Capabilities.RequestedStandaloneCapabilities,
    filterOut?: boolean
): Omit<WebdriverIO.Capabilities, 'logLevel'> {
    const caps = 'alwaysMatch' in capabilities ? capabilities.alwaysMatch : capabilities
    const defaultConfigsKeys = [
        ...Object.keys(DEFAULT_CONFIGS()),
        ...Object.keys(DEFAULTS)
    ]

    return Object.fromEntries(Object.entries(caps).filter(([key]) => (
        defaultConfigsKeys.includes(key) === Boolean(filterOut)
    )))
}

export async function initializeStubSession(
    config: WebdriverIO.Config,
    capabilities: Capabilities.RequestedStandaloneCapabilities | Capabilities.RequestedMultiremoteCapabilities,
    isMultiremote = false
) {
    await enableFileLogging(config.outputDir)

    const stubConfig = {
        ...config,
        // @ts-ignore used internally by webdriverio
        _automationProtocol: config.automationProtocol,
        automationProtocol: './protocol-stub.js'
    }

    let browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser
    if (!isMultiremote) {
        // SAFETY: The caller selects standalone mode, whose payload is a flat or W3C capability object.
        const standalone = capabilities as Capabilities.RequestedStandaloneCapabilities
        const sessionConfig: Capabilities.WebdriverIOConfig = {
            ...stubConfig,
            ...sanitizeCaps(standalone, true),
            capabilities: sanitizeCaps(standalone)
        }
        browser = await remote(sessionConfig)
    } else {
        const options: Capabilities.RequestedMultiremoteCapabilities = {}
        // @ts-expect-error config mutation matches WDIO runner behavior
        delete stubConfig.capabilities
        // SAFETY: The caller selects multiremote mode, whose payload maps browser names to session options.
        const multiremoteCaps = capabilities as Capabilities.RequestedMultiremoteCapabilities
        for (const browserName of Object.keys(multiremoteCaps)) {
            options[browserName] = deepmerge(
                stubConfig,
                multiremoteCaps[browserName]
            )
        }
        browser = await multiremote(options, stubConfig)
    }

    _setGlobal('browser', browser, config.injectGlobals)
    _setGlobal('driver', browser, config.injectGlobals)
    _setGlobal('expect', expect, config.injectGlobals)
    setOptions({
        wait: config.waitforTimeout,
        interval: config.waitforInterval,
        beforeAssertion: async () => {},
        afterAssertion: async () => {}
    })

    return browser
}
