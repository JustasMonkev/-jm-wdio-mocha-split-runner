import Mocha from 'mocha'
import { describe, expect, it } from 'vitest'

import { buildManifest } from '../src/framework.js'
import { verifyAndPruneToShard } from '../src/mocha/parallel.js'

describe('parallel manifest helpers', () => {
    it('assigns stable selector ids for duplicate titles', () => {
        const mocha = new Mocha()
        const suite = Mocha.Suite.create(mocha.suite, 'suite')
        const first = new Mocha.Test('same title', () => {})
        const second = new Mocha.Test('same title', () => {})
        first.file = '/spec.js'
        second.file = '/spec.js'
        suite.addTest(first)
        suite.addTest(second)

        const manifest = buildManifest(mocha, '/spec.js', {})

        expect(manifest.tests).toHaveLength(2)
        expect(manifest.tests[0].selectorId).not.toBe(manifest.tests[1].selectorId)
        expect(manifest.tests[0].fullTitle).toBe('suite same title')
        expect(manifest.tests[1].fullTitle).toBe('suite same title')
    })

    it('prunes the suite tree to the selected test branch', () => {
        const mocha = new Mocha()
        const top = Mocha.Suite.create(mocha.suite, 'top')
        const branch = Mocha.Suite.create(top, 'branch')
        const keep = new Mocha.Test('keep', () => {})
        const drop = new Mocha.Test('drop', () => {})
        keep.file = '/spec.js'
        drop.file = '/spec.js'
        branch.addTest(keep)
        branch.addTest(drop)

        const manifest = buildManifest(mocha, '/spec.js', {})

        verifyAndPruneToShard(mocha, {
            mode: 'run',
            specFile: '/spec.js',
            selectorId: manifest.tests[0].selectorId,
            manifestHash: manifest.manifestHash
        }, {})

        expect(mocha.suite.suites[0].title).toBe('top')
        expect(mocha.suite.suites[0].suites[0].title).toBe('branch')
        expect(mocha.suite.suites[0].suites[0].tests).toHaveLength(1)
        expect(mocha.suite.suites[0].suites[0].tests[0].title).toBe('keep')
    })

    it('prunes the suite tree to a selected subset of tests from the same file', () => {
        const mocha = new Mocha()
        const top = Mocha.Suite.create(mocha.suite, 'top')
        const branch = Mocha.Suite.create(top, 'branch')
        const keepOne = new Mocha.Test('keep one', () => {})
        const keepTwo = new Mocha.Test('keep two', () => {})
        const drop = new Mocha.Test('drop', () => {})
        keepOne.file = '/spec.js'
        keepTwo.file = '/spec.js'
        drop.file = '/spec.js'
        branch.addTest(keepOne)
        branch.addTest(keepTwo)
        branch.addTest(drop)

        const manifest = buildManifest(mocha, '/spec.js', {})

        verifyAndPruneToShard(mocha, {
            mode: 'subset',
            specFile: '/spec.js',
            selectorIds: [
                manifest.tests[0].selectorId,
                manifest.tests[1].selectorId
            ],
            manifestHash: manifest.manifestHash
        }, {})

        expect(mocha.suite.suites[0].title).toBe('top')
        expect(mocha.suite.suites[0].suites[0].title).toBe('branch')
        expect(mocha.suite.suites[0].suites[0].tests).toHaveLength(2)
        expect(mocha.suite.suites[0].suites[0].tests.map((test) => test.title)).toEqual(['keep one', 'keep two'])
    })

    it('honors exclusive branches, pending tests, and reusable grep expressions', () => {
        const mocha = new Mocha()
        const only = Mocha.Suite.create(mocha.suite, 'only')
        const other = Mocha.Suite.create(mocha.suite, 'other')
        only.addTest(new Mocha.Test('keep', () => {}))
        only.addTest(new Mocha.Test('skip'))
        other.addTest(new Mocha.Test('drop', () => {}))
        mocha.suite['_onlySuites'].push(only)

        const grep = /keep/g
        expect(buildManifest(mocha, '/spec.js', { grep }).tests.map(test => test.fullTitle)).toEqual(['only keep'])
        expect(buildManifest(mocha, '/spec.js', { grep }).tests.map(test => test.fullTitle)).toEqual(['only keep'])
        expect(buildManifest(mocha, '/spec.js', { grep, invert: true }).tests).toEqual([])
    })

})
