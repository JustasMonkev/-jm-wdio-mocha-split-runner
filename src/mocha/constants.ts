export const INTERFACES = {
    bdd: ['it', 'specify', 'before', 'beforeEach', 'after', 'afterEach'],
    tdd: ['test', 'suiteSetup', 'setup', 'suiteTeardown', 'teardown'],
    qunit: ['test', 'before', 'beforeEach', 'after', 'afterEach']
} as const

export const TEST_INTERFACES = {
    bdd: ['it', 'specify'],
    tdd: ['test'],
    qunit: ['test']
} as const

export const EVENTS = {
    suite: 'suite:start',
    'suite end': 'suite:end',
    test: 'test:start',
    'test end': 'test:end',
    hook: 'hook:start',
    'hook end': 'hook:end',
    pass: 'test:pass',
    fail: 'test:fail',
    retry: 'test:retry',
    pending: 'test:pending'
} as const

export const NOOP = function () {}
export const MOCHA_TIMEOUT_MESSAGE = 'For async tests and hooks, ensure "done()" is called; if returning a Promise, ensure it resolves.'
