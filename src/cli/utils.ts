import logger from '@wdio/logger'
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Services } from '@wdio/types'

const log = logger('@jm/wdio-mocha-split-runner:cli-utils')

export class HookError extends SevereServiceError {
    public origin: string

    constructor(message: string, origin: string) {
        super(message)
        this.origin = origin
    }
}

export async function runServiceHook(
    launcher: Services.ServiceInstance[],
    hookName: keyof Services.HookFunctions,
    ...args: unknown[]
) {
    const start = Date.now()
    return Promise.all(launcher.map(async (service: Services.ServiceInstance) => {
        try {
            if (typeof service[hookName] === 'function') {
                // SAFETY: The typeof check establishes a callable hook; WDIO supplies its arguments by hook name.
                await (service[hookName] as Function)(...args)
            }
        } catch (err) {
            const message = `A service failed in the '${hookName}' hook\n${(err as Error).stack}\n\n`
            if (err instanceof SevereServiceError || (err as Error).name === 'SevereServiceError') {
                return { status: 'rejected', reason: message, origin: hookName }
            }
            log.error(`${message}Continue...`)
        }
    })).then((results) => {
        if (launcher.length) {
            log.debug(`Finished to run "${hookName}" hook in ${Date.now() - start}ms`)
        }

        const rejectedHooks = results.filter((result) => result && result.status === 'rejected')
        if (rejectedHooks.length) {
            return Promise.reject(new HookError(
                `\n${rejectedHooks.map((result) => result && result.reason).join()}\n\nStopping runner...`,
                hookName
            ))
        }
    })
}

export async function runLauncherHook(hook: Function | Function[], ...args: unknown[]) {
    const hooks = typeof hook === 'function' ? [hook] : hook
    const catchFn = (err: Error) => {
        log.error(`Error in hook: ${err.stack}`)
        if (err instanceof SevereServiceError) {
            throw new HookError(err.message, hooks[0].name)
        }
    }

    return Promise.all(hooks.map((currentHook) => {
        try {
            return currentHook(...args)
        } catch (err) {
            return catchFn(err as Error)
        }
    })).catch(catchFn)
}

export async function runOnCompleteHook(
    onCompleteHook: Function | Function[],
    config: WebdriverIO.Config,
    capabilities: Capabilities.TestrunnerCapabilities,
    exitCode: number,
    results: { finished: number, passed: number, retries: number, failed: number }
) {
    const hooks = typeof onCompleteHook === 'function' ? [onCompleteHook] : onCompleteHook
    return Promise.all(hooks.map(async (hook) => {
        try {
            await hook(exitCode, config, capabilities, results)
            return 0
        } catch (err) {
            log.error(`Error in onCompleteHook: ${(err as Error).stack}`)
            if (err instanceof SevereServiceError) {
                throw new HookError(err.message, 'onComplete')
            }
            return 1
        }
    }))
}

export function getRunnerName(caps: WebdriverIO.Capabilities = {}) {
    let runner = caps.browserName ||
        caps.platformName ||
        caps['appium:platformName'] ||
        caps['appium:appPackage'] ||
        caps['appium:appWaitActivity'] ||
        caps['appium:app']

    if (!runner) {
        runner = Object.values(caps).length === 0 || Object.values(caps).some((cap) => !cap?.capabilities)
            ? 'undefined'
            : 'MultiRemote'
    }

    return runner
}

enum NodeVersion {
    major = 0,
    minor = 1,
    patch = 2
}

export function nodeVersion(type: keyof typeof NodeVersion): number {
    return process.versions.node.split('.').map(Number)[NodeVersion[type]]
}
