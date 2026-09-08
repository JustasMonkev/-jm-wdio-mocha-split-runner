import type { Runner } from 'mocha'

import logger from '@wdio/logger'
import { executeHooksWithArgs } from '@wdio/utils'
import type { Services } from '@wdio/types'

import { formatMessage } from './mocha/common.js'
import { EVENTS } from './mocha/constants.js'
import { createMochaRuntime, buildManifest, verifyAndPruneToShard } from './mocha/parallel.js'
import type { FrameworkMessage, MochaError, MochaPayload } from './mocha/types.js'
import type { EventEmitter } from 'node:events'
import type { ParallelRuntimeConfig } from './types.js'

const log = logger('@jm/wdio-mocha-split-runner:framework')

type EventTypes = 'hook' | 'test' | 'suite'

class ParallelMochaAdapter {
    private _mocha?: Awaited<ReturnType<typeof createMochaRuntime>>
    private _runner?: Runner
    private _specLoadError?: Error
    private _level = 0
    private _hasTests = true
    private _suiteIds: string[] = ['0']
    private _suiteCnt: Map<string, number> = new Map()
    private _hookCnt: Map<string, number> = new Map()
    private _testCnt: Map<string, number> = new Map()
    private _suiteStartDate = new Map<string, number>()

    constructor(
        private _cid: string,
        private _config: ParallelRuntimeConfig,
        private _specs: string[],
        private _capabilities: WebdriverIO.Capabilities,
        private _reporter: EventEmitter
    ) {
        this._config = Object.assign({ mochaOpts: {} }, _config)
    }

    async init() {
        try {
            this._mocha = await createMochaRuntime(this._cid, this._config, this._specs)
            if (this._config.parallelShard) {
                verifyAndPruneToShard(this._mocha, this._config.parallelShard, this._config.mochaOpts)
            }
            this._hasTests = buildManifest(this._mocha, this._specs[0], this._config.mochaOpts).tests.length > 0
        } catch (err) {
            this._specLoadError = err as Error
            this._hasTests = true
            log.warn((err as Error).stack || (err as Error).message)
        }

        return this
    }

    hasTests() {
        return this._hasTests
    }

    async run() {
        const mocha = this._mocha
        if (!mocha) {
            await executeHooksWithArgs('after', this._config.after, [this._specLoadError, this._capabilities, this._specs])
            if (this._specLoadError) {
                throw this._specLoadError
            }
            return 0
        }

        let runtimeError
        injectSuiteHooks(mocha.suite, (hookName, suite) => this.wrapSuiteHook(hookName, suite))

        const result = await new Promise<number>((resolve) => {
            try {
                this._runner = mocha.run(resolve)
            } catch (err) {
                runtimeError = err as Error
                resolve(1)
                return
            }

            for (const [eventName, messageType] of Object.entries(EVENTS)) {
                this._runner.on(eventName, this.emit.bind(this, messageType))
            }
        })

        await executeHooksWithArgs('after', this._config.after, [runtimeError || this._specLoadError || result, this._capabilities, this._specs])

        if (runtimeError || this._specLoadError) {
            throw runtimeError || this._specLoadError
        }

        return result
    }

    wrapSuiteHook(hookName: keyof Services.HookFunctions, suite: Mocha.Suite) {
        return () => executeHooksWithArgs(
            hookName,
            this._config[hookName],
            [this.prepareSuiteMessage(hookName, suite)]
        ).catch((err) => {
            log.error(`Error in ${hookName} hook: ${err instanceof Error ? err.stack?.slice(7) : String(err)}`)
        })
    }

    prepareSuiteMessage(hookName: keyof Services.HookFunctions, suite: Mocha.Suite & { duration?: number }) {
        const params: FrameworkMessage = { type: hookName, payload: suite }
        const key = suite.fullTitle() || suite.title
        if (hookName === 'beforeSuite') {
            this._suiteStartDate.set(key, Date.now())
        }
        if (hookName === 'afterSuite') {
            suite.duration = suite.duration || (Date.now() - (this._suiteStartDate.get(key) || Date.now()))
        }
        return formatMessage(params)
    }

    emit(event: string, payload: MochaPayload, err?: MochaError) {
        if (payload.root) {
            return
        }

        const message = formatMessage({ type: event, payload, err })
        message.cid = this._cid
        message.specs = this._specs
        message.uid = this.getUID(message)
        this._reporter.emit(message.type, message)
    }

    getSyncEventIdStart(type: EventTypes) {
        const prop = `_${type}Cnt` as const
        const suiteId = this._suiteIds[this._suiteIds.length - 1]
        const cnt = this[prop].get(suiteId) || 0
        this[prop].set(suiteId, cnt + 1)
        return `${type}-${suiteId}-${cnt}`
    }

    getSyncEventIdEnd(type: EventTypes) {
        const prop = `_${type}Cnt` as const
        const suiteId = this._suiteIds[this._suiteIds.length - 1]
        const cnt = this[prop].get(suiteId)! - 1
        return `${type}-${suiteId}-${cnt}`
    }

    getUID(message: FrameworkMessage) {
        if (message.type === 'suite:start') {
            const suiteCnt = this._suiteCnt.has(this._level.toString()) ? this._suiteCnt.get(this._level.toString()) : 0
            const suiteId = `suite-${this._level}-${suiteCnt}`
            if (this._suiteCnt.has(this._level.toString())) {
                this._suiteCnt.set(this._level.toString(), this._suiteCnt.get(this._level.toString())! + 1)
            } else {
                this._suiteCnt.set(this._level.toString(), 1)
            }
            this._suiteIds.push(`${this._level}${suiteCnt}`)
            this._level++
            return suiteId
        }
        if (message.type === 'suite:end') {
            this._level--
            const suiteCnt = this._suiteCnt.get(this._level.toString())! - 1
            const suiteId = `suite-${this._level}-${suiteCnt}`
            this._suiteIds.pop()
            return suiteId
        }
        if (message.type === 'hook:start') {
            return this.getSyncEventIdStart('hook')
        }
        if (message.type === 'hook:end') {
            return this.getSyncEventIdEnd('hook')
        }
        if (['test:start', 'test:pending'].includes(message.type)) {
            return this.getSyncEventIdStart('test')
        }
        if (['test:end', 'test:pass', 'test:fail', 'test:retry'].includes(message.type)) {
            return this.getSyncEventIdEnd('test')
        }
        throw new Error(`Unknown message type : ${message.type}`)
    }
}

function injectSuiteHooks(suite: Mocha.Suite, wrapHook: (hookName: keyof Services.HookFunctions, suite: Mocha.Suite) => () => Promise<unknown>) {
    for (const childSuite of suite.suites) {
        childSuite.beforeAll(wrapHook('beforeSuite', childSuite))
        childSuite.afterAll(wrapHook('afterSuite', childSuite))
        injectSuiteHooks(childSuite, wrapHook)
    }
}

const adapterFactory = {
    init: (...args: ConstructorParameters<typeof ParallelMochaAdapter>) => new ParallelMochaAdapter(...args).init()
}

export default adapterFactory
export { ParallelMochaAdapter, adapterFactory, buildManifest, createMochaRuntime }
