declare module 'async-exit-hook'

// The installed @wdio/utils Node export omits its declarations from the export map.
declare module '@wdio/utils/node' {
    import type { Capabilities, Options } from '@wdio/types'
    export function setupDriver(config: Omit<Options.WebDriver, 'capabilities'>, caps: Capabilities.TestrunnerCapabilities): Promise<unknown[] | undefined>
    export function setupBrowser(config: Omit<Options.WebDriver, 'capabilities'>, caps: Capabilities.TestrunnerCapabilities): Promise<unknown[]> | undefined
}
