import type { Services } from '@wdio/types'

const BROWSERSTACK_SERVICE_NAMES = new Set([
    'browserstack',
    '@wdio/browserstack-service'
])

const BROWSERSTACK_SERVICE_CLASS_NAMES = new Set([
    'browserstackservice',
    'browserstacklauncherservice'
])

function getServiceIdentifier(service: Services.ServiceEntry) {
    if (typeof service === 'string') {
        return service
    }

    if (typeof service === 'function') {
        return service.name
    }

    if (Array.isArray(service)) {
        return getServiceIdentifier(service[0] as Services.ServiceEntry)
    }

    if (service && typeof service === 'object') {
        return service.constructor?.name
    }

    return undefined
}

export function hasBrowserstackService(services: Services.ServiceEntry[] = []) {
    return services.some(isBrowserstackService)
}

export function isBrowserstackService(service: Services.ServiceEntry) {
    const serviceIdentifier = getServiceIdentifier(service)
    if (typeof serviceIdentifier !== 'string') {
        return false
    }

    return BROWSERSTACK_SERVICE_NAMES.has(serviceIdentifier) ||
        BROWSERSTACK_SERVICE_CLASS_NAMES.has(serviceIdentifier.toLowerCase())
}

export function getDiscoveryServices(services: Services.ServiceEntry[] = []) {
    return services.filter((service) => !isBrowserstackService(service))
}

export function getDiscoveryIgnoredWorkerServices(
    services: Services.ServiceEntry[] = [],
    ignoredWorkerServices: string[] = []
) {
    const discoveryIgnoredServices = new Set(ignoredWorkerServices)

    for (const service of services) {
        const serviceIdentifier = getServiceIdentifier(service)
        if (typeof serviceIdentifier === 'string' && isBrowserstackService(service)) {
            discoveryIgnoredServices.add(serviceIdentifier)
        }
    }

    return Array.from(discoveryIgnoredServices)
}

export function getDiscoveryLauncherServices<T extends Services.ServiceInstance>(
    launcherServices: T[] = [],
    configuredServices: Services.ServiceEntry[] = []
) {
    if (!hasBrowserstackService(configuredServices)) {
        return launcherServices
    }

    return launcherServices.filter((service) => !isBrowserstackLauncherService(service))
}

function isBrowserstackLauncherService(service: Services.ServiceInstance) {
    const constructorName = service?.constructor?.name ?? ''
    return /^browserstacklauncherservice$/i.test(constructorName)
}
