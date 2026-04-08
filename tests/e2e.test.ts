import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

type TraceEvent = {
    event: string
    timestamp: number
    pid: number
    cid?: string
    parallelPhase?: string
    title?: string
    testFile?: string | null
    passed?: boolean
}

const ROOT_DIR = '/Users/justas/Desktop/custom-runner/custom-runner'
const tempDirs: string[] = []

function getTraceFile(eventsDir: string) {
    return path.join(eventsDir, 'trace.ndjson')
}

function normalizeBasename(filePath?: string | null) {
    if (!filePath) {
        return ''
    }

    const normalized = filePath.startsWith('file://')
        ? new URL(filePath).pathname
        : filePath

    return path.basename(normalized)
}

function readTrace(traceFile: string): TraceEvent[] {
    if (!fs.existsSync(traceFile)) {
        return []
    }

    return fs.readFileSync(traceFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEvent)
}

function getMaxConcurrentTests(events: TraceEvent[], testFile: string) {
    const timeline = events
        .filter((event) => normalizeBasename(event.testFile) === testFile)
        .filter((event) => event.event === 'test:start' || event.event === 'test:end')
        .map((event) => ({
            timestamp: event.timestamp,
            delta: event.event === 'test:start' ? 1 : -1
        }))
        .sort((left, right) => left.timestamp - right.timestamp || left.delta - right.delta)

    let active = 0
    let maxActive = 0
    for (const entry of timeline) {
        active += entry.delta
        maxActive = Math.max(maxActive, active)
    }

    return maxActive
}

function runScenario(configFile: string, extraEnv: Record<string, string> = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdio-mocha-split-runner-e2e-'))
    tempDirs.push(tempDir)

    const traceFile = getTraceFile(tempDir)
    const flakyDir = path.join(tempDir, 'flaky')
    const result = spawnSync('node', ['./bin/wdio-mocha-split-runner.js', 'run', `./example/${configFile}`], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 120000,
        env: {
            ...process.env,
            WDIO_LOG_LEVEL: 'error',
            PARALLEL_DELAY_SCALE: '0.15',
            PARALLEL_TRACE_FILE: traceFile,
            PARALLEL_FLAKE_DIR: flakyDir,
            ...extraEnv
        }
    })

    return {
        ...result,
        trace: readTrace(traceFile)
    }
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const tempDir = tempDirs.pop()
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    }
})

describe('wdio-mocha-split-runner chrome e2e', () => {
    it('splits mixed.e2e.ts into overlapping jobs', { timeout: 120000 }, () => {
        const result = runScenario('wdio.conf.ts')

        expect(result.status, result.stderr || result.stdout).toBe(0)

        const mixedStarts = result.trace
            .filter((event) => event.event === 'test:start')
            .filter((event) => normalizeBasename(event.testFile) === 'mixed.e2e.ts')

        expect(mixedStarts.map((event) => event.title).sort()).toEqual([
            'alpha test 1',
            'alpha test 2',
            'alpha test 3',
            'alpha test 4'
        ].sort())
        expect(new Set(mixedStarts.map((event) => event.pid)).size).toBeGreaterThan(1)
        expect(getMaxConcurrentTests(result.trace, 'mixed.e2e.ts')).toBeGreaterThan(1)
    })

    it('keeps mixed.e2e.ts serial when split mode is disabled', { timeout: 120000 }, () => {
        const result = runScenario('wdio.stock.conf.ts')

        expect(result.status, result.stderr || result.stdout).toBe(0)

        const mixedStarts = result.trace
            .filter((event) => event.event === 'test:start')
            .filter((event) => normalizeBasename(event.testFile) === 'mixed.e2e.ts')

        expect(new Set(mixedStarts.map((event) => event.pid)).size).toBe(1)
        expect(getMaxConcurrentTests(result.trace, 'mixed.e2e.ts')).toBe(1)
        expect(new Set(
            result.trace
                .filter((event) => event.event === 'session:start')
                .map((event) => event.parallelPhase)
        )).toEqual(new Set(['spec']))
    })

    it('respects maxSplitInstances across multiple split files', { timeout: 120000 }, () => {
        const result = runScenario('wdio.global-limit.conf.ts')

        expect(result.status, result.stderr || result.stdout).toBe(0)

        const splitStarts = result.trace.filter((event) =>
            event.event === 'test:start' &&
            ['limit-a.e2e.ts', 'limit-b.e2e.ts'].includes(normalizeBasename(event.testFile))
        )

        expect(splitStarts).toHaveLength(4)
        expect(getMaxConcurrentTests(result.trace, 'limit-a.e2e.ts') + getMaxConcurrentTests(result.trace, 'limit-b.e2e.ts')).toBeGreaterThan(1)

        const timeline = result.trace
            .filter((event) => ['limit-a.e2e.ts', 'limit-b.e2e.ts'].includes(normalizeBasename(event.testFile)))
            .filter((event) => event.event === 'test:start' || event.event === 'test:end')
            .map((event) => ({
                timestamp: event.timestamp,
                delta: event.event === 'test:start' ? 1 : -1
            }))
            .sort((left, right) => left.timestamp - right.timestamp || left.delta - right.delta)

        let active = 0
        let maxActive = 0
        for (const entry of timeline) {
            active += entry.delta
            maxActive = Math.max(maxActive, active)
        }

        expect(maxActive).toBeLessThanOrEqual(2)
    })

    it('retries only the failing split shard', { timeout: 120000 }, () => {
        const result = runScenario('wdio.retry.conf.ts')

        expect(result.status, result.stderr || result.stdout).toBe(0)

        const flakyStarts = result.trace.filter((event) => event.event === 'test:start' && event.title === 'flaky test')
        const stableStarts = result.trace.filter((event) => event.event === 'test:start' && event.title === 'stable test')
        const flakyEnds = result.trace.filter((event) => event.event === 'test:end' && event.title === 'flaky test')

        expect(stableStarts).toHaveLength(1)
        expect(flakyStarts).toHaveLength(2)
        expect(flakyEnds.some((event) => event.passed === false)).toBe(true)
        expect(flakyEnds.some((event) => event.passed === true)).toBe(true)
    })
})
