declare module 'async-exit-hook'
declare module '@wdio/utils/node' {
    export const setupDriver: (...args: any[]) => Promise<any>
    export const setupBrowser: (...args: any[]) => Promise<any>
}
