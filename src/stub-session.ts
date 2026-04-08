import { _setGlobal } from '@wdio/globals'
import { expect, setOptions } from 'expect-webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import { DEFAULTS } from 'webdriver'
import { DEFAULT_CONFIGS } from '@wdio/config'
import { remote, multiremote, type AttachOptions } from 'webdriverio'
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

    return Object.keys(caps).filter((key: keyof WebdriverIO.Capabilities) => (
        !defaultConfigsKeys.includes(key as string) === !filterOut
    )).reduce((obj: WebdriverIO.Capabilities, key: keyof WebdriverIO.Capabilities) => {
        obj[key] = caps[key] as undefined
        return obj
    }, {})
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
        const sessionConfig: Capabilities.WebdriverIOConfig = {
            ...stubConfig,
            ...sanitizeCaps(capabilities as Options.Connection, true),
            capabilities: sanitizeCaps(capabilities as Capabilities.RequestedStandaloneCapabilities)
        }
        browser = await remote(sessionConfig)
    } else {
        const options: Capabilities.RequestedMultiremoteCapabilities = {}
        // @ts-expect-error config mutation matches WDIO runner behavior
        delete stubConfig.capabilities
        for (const browserName of Object.keys(capabilities)) {
            options[browserName] = deepmerge(
                stubConfig,
                (capabilities as Capabilities.RequestedMultiremoteCapabilities)[browserName]
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
