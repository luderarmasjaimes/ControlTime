import { fetchPlatformCountries, fetchPlatformUiLanguages } from './authApi'

export interface PlatformCatalog {
    countries: any;
    languages: any;
}

let cache: PlatformCatalog | null = null
let inflight: Promise<PlatformCatalog> | null = null

export async function loadPlatformCatalog(): Promise<PlatformCatalog> {
    if (cache) {
        return cache
    }
    if (inflight) {
        return inflight
    }
    inflight = (async () => {
        const [countries, languages] = await Promise.all([
            fetchPlatformCountries(),
            fetchPlatformUiLanguages(),
        ])
        cache = { countries, languages }
        return cache
    })().finally(() => {
        inflight = null
    })
    return inflight
}

export function getCachedPlatformCatalog(): PlatformCatalog | null {
    return cache
}
