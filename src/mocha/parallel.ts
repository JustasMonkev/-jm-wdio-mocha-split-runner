import crypto from 'node:crypto'
import path from 'node:path'
import url from 'node:url'

import Mocha from 'mocha'
// @ts-expect-error Mocha doesn't expose this helper as part of its types
import { handleRequires } from 'mocha/lib/cli/run-helpers.js'

import logger from '@wdio/logger'

import { setupEnv } from './common.js'
import { NOOP } from './constants.js'
import type { MochaOpts } from './types.js'
import type { ParallelRuntimeConfig, ParallelShard, ParallelTestManifest, ParallelTestManifestEntry } from '../types.js'

const log = logger('@jm/wdio-mocha-split-runner:mocha')
const FILE_PROTOCOL = 'file://'

type MochaTest = Mocha.Test & { isOnly?: () => boolean, _only?: boolean }
type MochaSuite = Mocha.Suite & { hasOnly?: () => boolean, _only?: boolean }

type SelectedRunnable = {
    descriptor: ParallelTestManifestEntry
    test: MochaTest
}

export async function createMochaRuntime(
    cid: string,
    config: ParallelRuntimeConfig,
    specs: string[]
) {
    const mochaOpts = config.mochaOpts || {}

    if (Array.isArray(mochaOpts.require)) {
        const plugins = await handleRequires(
            mochaOpts.require
                .filter((entry) => typeof entry === 'string')
                .map((entry) => path.resolve(config.rootDir, entry))
        )
        Object.assign(mochaOpts, plugins)
    }

    const mocha = new Mocha(mochaOpts)
    // Base would add listeners that mutate failure objects and test timing metadata.
    // SAFETY: Mocha only constructs this inert reporter; its typings unnecessarily require Base's methods.
    mocha.reporter(NOOP as unknown as Mocha.ReporterConstructor)
    mocha.fullTrace()

    specs.forEach((spec) => mocha.addFile(spec.startsWith(FILE_PROTOCOL) ? url.fileURLToPath(spec) : spec))

    const { beforeTest, beforeHook, afterTest, afterHook } = config
    mocha.suite.on('pre-require', () => setupEnv(
        cid,
        mochaOpts,
        beforeTest || [],
        beforeHook || [],
        afterTest || [],
        afterHook || []
    ))
    mocha.suite.on('require', () => mocha.unloadFiles())
    // @ts-ignore outdated mocha types
    await mocha.loadFilesAsync({
        esmDecorator: (file: string) => `${file}?invalidateCache=${Math.random()}`
    })

    return mocha
}

export function buildManifest(mocha: Mocha, specFile: string, mochaOpts: MochaOpts): ParallelTestManifest {
    const tests = collectRunnableTests(mocha.suite, specFile, mochaOpts).map((entry) => entry.descriptor)
    return {
        specFile,
        tests,
        manifestHash: createManifestHash(tests)
    }
}

export function verifyAndPruneToShard(mocha: Mocha, shard: ParallelShard, mochaOpts: MochaOpts) {
    const selected = collectRunnableTests(mocha.suite, shard.specFile, mochaOpts)
    const manifestHash = createManifestHash(selected.map((entry) => entry.descriptor))
    if (manifestHash !== shard.manifestHash) {
        throw new Error(`Parallel manifest mismatch for ${shard.specFile}. Discovery hash ${shard.manifestHash} did not match execution hash ${manifestHash}.`)
    }

    if (shard.mode === 'run') {
        const match = selected.find((entry) => entry.descriptor.selectorId === shard.selectorId)
        if (!match) {
            throw new Error(`Unable to resolve selected test "${shard.selectorId}" in ${shard.specFile}.`)
        }
        pruneSuiteTree(mocha.suite, [match.test])
        return
    }

    const normalizedSelectorIds = Array.from(new Set(
        shard.selectorIds.filter((selectorId): selectorId is string => typeof selectorId === 'string' && selectorId.length > 0)
    ))
    if (normalizedSelectorIds.length === 0) {
        throw new Error(`Unable to resolve any selected tests in ${shard.specFile}. selectorIds payload was empty or invalid.`)
    }

    const requestedSelectors = new Set(normalizedSelectorIds)
    const matchingTests = selected
        .filter((entry) => requestedSelectors.has(entry.descriptor.selectorId))
        .map((entry) => entry.test)

    if (matchingTests.length !== normalizedSelectorIds.length) {
        const resolvedSelectors = new Set(selected.map((entry) => entry.descriptor.selectorId))
        const missingSelector = normalizedSelectorIds.find((selectorId) => !resolvedSelectors.has(selectorId))
        throw new Error(`Unable to resolve selected test "${missingSelector}" in ${shard.specFile}.`)
    }

    pruneSuiteTree(mocha.suite, matchingTests)
}

export function classifyDiscoveryError(error: Error) {
    const message = `${error.message}\n${error.stack || ''}`
    if (/browser object|not fully initialized|deleteSession|getWindowHandle|session/i.test(message)) {
        return 'fallback'
    }
    return 'fatal'
}

function collectRunnableTests(root: MochaSuite, specFile: string, mochaOpts: MochaOpts): SelectedRunnable[] {
    const onlyMode = suiteHasOnly(root)
    const grep = normalizeGrep(mochaOpts.grep)
    const seen = new Map<string, number>()
    const entries: SelectedRunnable[] = []

    const visitSuite = (suite: MochaSuite) => {
        for (const test of suite.tests) {
            if (isPending(test)) {
                continue
            }
            if (onlyMode && !isInOnlyBranch(test)) {
                continue
            }

            const fullTitle = test.fullTitle()
            if (grep && applyGrep(grep, fullTitle, Boolean(mochaOpts.invert))) {
                continue
            }

            const suitePath = getSuitePath(test)
            const occurrenceKey = `${specFile}\u0000${suitePath.join('\u0000')}\u0000${test.title}`
            const occurrenceIndex = seen.get(occurrenceKey) || 0
            seen.set(occurrenceKey, occurrenceIndex + 1)

            entries.push({
                descriptor: {
                    selectorId: `${occurrenceKey}#${occurrenceIndex}`,
                    fullTitle,
                    suitePath,
                    file: test.file || specFile,
                    retries: test.retries()
                },
                test
            })
        }

        for (const childSuite of suite.suites) {
            visitSuite(childSuite)
        }
    }

    visitSuite(root)
    return entries
}

function createManifestHash(entries: ParallelTestManifestEntry[]) {
    return crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex')
}

function pruneSuiteTree(root: MochaSuite, selectedTests: MochaTest[]) {
    const selectedTestsSet = new Set(selectedTests)
    const keptSuites = new Set<MochaSuite>()
    for (const selectedTest of selectedTests) {
        let currentSuite = selectedTest.parent
        while (currentSuite) {
            keptSuites.add(currentSuite)
            currentSuite = currentSuite.parent
        }
    }

    const prune = (suite: MochaSuite) => {
        suite.tests = suite.tests.filter((test: MochaTest) => selectedTestsSet.has(test))
        suite.suites = suite.suites.filter((childSuite: MochaSuite) => keptSuites.has(childSuite))
        suite.suites.forEach(prune)
    }

    prune(root)
}

function normalizeGrep(grep?: RegExp | string) {
    if (!grep) {
        return
    }
    return grep instanceof RegExp ? grep : new RegExp(grep)
}

function applyGrep(grep: RegExp, fullTitle: string, invert: boolean) {
    const matched = grep.test(fullTitle)
    grep.lastIndex = 0
    return invert ? matched : !matched
}

function getSuitePath(test: MochaTest) {
    const suitePath: string[] = []
    let parent: MochaSuite | undefined = test.parent
    while (parent && !parent.root) {
        suitePath.unshift(parent.title)
        parent = parent.parent
    }
    return suitePath
}

function isPending(test: MochaTest) {
    return Boolean(test.pending || test.isPending?.())
}

function suiteHasOnly(suite: MochaSuite): boolean {
    if (typeof suite.hasOnly === 'function' && suite.hasOnly()) {
        return true
    }
    // Mocha 10 stores exclusive selections in these internal arrays.
    const onlyTests: Mocha.Test[] = suite['_onlyTests']
    const onlySuites: Mocha.Suite[] = suite['_onlySuites']
    if (onlyTests.length > 0 || onlySuites.length > 0) {
        return true
    }
    return suite.suites.some((childSuite: MochaSuite) => suiteHasOnly(childSuite))
}

function isInOnlyBranch(test: MochaTest) {
    if (test.isOnly?.() || test._only) {
        return true
    }

    let parent: MochaSuite | undefined = test.parent
    while (parent) {
        const onlyTests: Mocha.Test[] = parent['_onlyTests']
        const onlySuites: Mocha.Suite[] = parent['_onlySuites']
        if (parent._only || onlyTests.includes(test) || onlySuites.some((suite) => isSuiteAncestorOf(test, suite))) {
            return true
        }
        parent = parent.parent
    }

    return false
}

function isSuiteAncestorOf(test: MochaTest, targetSuite: MochaSuite) {
    let parent: MochaSuite | undefined = test.parent
    while (parent) {
        if (parent === targetSuite) {
            return true
        }
        parent = parent.parent
    }
    return false
}

export function logManifestFallback(specFile: string, error: Error) {
    log.warn(`Falling back to spec-level execution for ${specFile}: ${error.message}`)
}
