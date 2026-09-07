import { wrapGlobalTestMethod } from '@wdio/utils'

import { INTERFACES, TEST_INTERFACES, MOCHA_TIMEOUT_MESSAGE } from './constants.js'
import type { FormattedMessage, FrameworkMessage, MochaOpts, MochaPayload } from './types.js'

const MOCHA_UI_TYPE_EXTRACTOR = /^(?:.*-)?([^-.]+)(?:.js)?$/
const DEFAULT_INTERFACE_TYPE = 'bdd'


export function formatMessage(params: FrameworkMessage) {
    const message: FormattedMessage = {
        type: params.type
    }
    const payload = params.payload
    const mochaAllHooksIfPresent = payload?.title?.match(/^"(before|after)( all| each)?" hook/)

    if (params.err) {
        const isSkipError = /^(sync|async) skip; aborting execution$/.test(params.err.message || '')
        const isHookSkip = isSkipError && mochaAllHooksIfPresent

        if (isHookSkip) {
            message.type = 'hook:end'
        } else {
            if (params.err.message?.includes(MOCHA_TIMEOUT_MESSAGE)) {
                const testName = (payload?.parent?.title ? `${payload.parent.title} ${payload.title}` : payload?.title) || 'unknown test'
                const replacement = `The execution in the test "${testName}" took too long. Try to reduce the run time or increase your timeout for test specs (https://webdriver.io/docs/timeouts).`
                params.err.message = params.err.message.replace(MOCHA_TIMEOUT_MESSAGE, replacement)
                params.err.stack = params.err.stack.replace(MOCHA_TIMEOUT_MESSAGE, replacement)
            }

            message.error = {
                name: params.err.name,
                message: params.err.message,
                stack: params.err.stack,
                type: params.err.type || params.err.name,
                expected: params.err.expected,
                actual: params.err.actual
            }

            if (mochaAllHooksIfPresent) {
                message.type = 'hook:end'
            }
        }
    }

    if (payload) {
        message.title = payload.title
        message.parent = payload.parent ? payload.parent.title : undefined

        let fullTitle = message.title
        if (payload.parent) {
            let parent: MochaPayload | null | undefined = payload.parent
            while (parent && parent.title) {
                fullTitle = parent.title + '.' + fullTitle
                parent = parent.parent
            }
        }

        message.fullTitle = fullTitle
        message.pending = payload.pending || false
        message.file = payload.file
        message.duration = payload.duration
        message.body = payload.body

        if (payload.ctx && payload.ctx.currentTest) {
            message.currentTest = payload.ctx.currentTest.title
        }

        if (params.type.match(/Test/)) {
            message.passed = payload.state === 'passed'
        }

        if (payload.parent?.title && mochaAllHooksIfPresent) {
            message.title = `${mochaAllHooksIfPresent[0]} for ${payload.parent.title}`
        }

        if (payload.context) {
            message.context = payload.context
        }
    }

    return message
}

export function requireExternalModules(mods: string[], loader = loadModule) {
    return mods.map((mod) => {
        if (!mod) {
            return Promise.resolve()
        }

        mod = mod.includes(':') ? mod.substring(mod.lastIndexOf(':') + 1) : mod
        if (mod.startsWith('./') && globalThis.process) {
            mod = `${globalThis.process.cwd()}/${mod.slice(2)}`
        }
        return loader(mod)
    })
}

type Hook = Function | Function[]
export function setupEnv(cid: string, options: MochaOpts, beforeTest: Hook, beforeHook: Hook, afterTest: Hook, afterHook: Hook) {
    const ui = MOCHA_UI_TYPE_EXTRACTOR.exec(options.ui || '')?.[1]
    const type = ui === 'tdd' || ui === 'qunit' ? ui : DEFAULT_INTERFACE_TYPE

    const hookArgsFn: Parameters<typeof wrapGlobalTestMethod>[2] = (value) => {
        // SAFETY: The Mocha test interface invokes this callback with its current Context.
        const context = value as Mocha.Context
        return [{ ...context.test, parent: context.test?.parent?.title }, context]
    }

    INTERFACES[type].forEach((fnName: string) => {
        const isTest = TEST_INTERFACES[type].flatMap((testCommand: string) => [testCommand, `${testCommand}.only`]).includes(fnName)
        wrapGlobalTestMethod(
            isTest,
            isTest ? beforeTest! : beforeHook!,
            hookArgsFn,
            isTest ? afterTest : afterHook,
            hookArgsFn,
            fnName,
            cid
        )
    })

    const { compilers = [] } = options
    return requireExternalModules([...compilers])
}

export async function loadModule(name: string) {
    try {
        return await import(/* @vite-ignore */name)
    } catch {
        throw new Error(`Module ${name} can't get loaded. Are you sure you have installed it?\nNote: if you've installed WebdriverIO globally you need to install these external modules globally too!`)
    }
}
