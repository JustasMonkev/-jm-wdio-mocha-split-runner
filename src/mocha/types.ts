export interface MochaOpts {
    require?: string[]
    compilers?: string[]
    allowUncaught?: boolean
    asyncOnly?: boolean
    bail?: boolean
    checkLeaks?: boolean
    delay?: boolean
    fgrep?: string
    forbidOnly?: boolean
    forbidPending?: boolean
    fullTrace?: boolean
    global?: string[]
    grep?: RegExp | string
    invert?: boolean
    retries?: number
    timeout?: number | string
    ui?: 'bdd' | 'tdd' | 'qunit' | 'exports'
}

export interface MochaError {
    name: string
    message: string
    stack: string
    type: string
    expected: unknown
    actual: unknown
}

export interface FrameworkMessage {
    type: string
    payload?: unknown
    err?: MochaError
}

export interface FormattedMessage {
    type: string
    cid?: string
    specs?: string[]
    uid?: string
    title?: string
    parent?: string
    fullTitle?: string
    pending?: boolean
    passed?: boolean
    file?: string
    duration?: number
    currentTest?: string
    error?: MochaError
    context?: unknown
    body?: string
}
