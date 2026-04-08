import fs from 'node:fs'
import path from 'node:path'

type TraceRuntime = {
    cid?: string
    specs?: string[]
    parallelizeTestsContext?: WebdriverIO.Config['parallelizeTestsContext']
}

const TRACE_STATE = Symbol.for('@jm/wdio-mocha-split-runner/example-trace')

function getTraceStore(): { runtime: TraceRuntime } {
    const globalStore = globalThis as typeof globalThis & {
        [TRACE_STATE]?: { runtime: TraceRuntime }
    }

    if (!globalStore[TRACE_STATE]) {
        globalStore[TRACE_STATE] = { runtime: {} }
    }

    return globalStore[TRACE_STATE]
}

export function setTraceRuntime(runtime: TraceRuntime) {
    getTraceStore().runtime = runtime
}

export function appendTrace(event: Record<string, unknown>) {
    const traceFile = process.env.PARALLEL_TRACE_FILE
    if (!traceFile) {
        return
    }

    const { runtime } = getTraceStore()
    const entry = {
        timestamp: Date.now(),
        pid: process.pid,
        cid: runtime.cid,
        specFile: runtime.specs?.[0],
        parallelPhase: runtime.parallelizeTestsContext?.phase ?? 'spec',
        selectorId: runtime.parallelizeTestsContext?.selectorId ?? null,
        selectorIds: runtime.parallelizeTestsContext?.selectorIds ?? null,
        ...event
    }

    fs.mkdirSync(path.dirname(traceFile), { recursive: true })
    fs.appendFileSync(traceFile, `${JSON.stringify(entry)}\n`)
}
