import { fetchPlatformCountries, fetchPlatformUiLanguages } from './authApi'

let cache = null
let inflight = null

export async function loadPlatformCatalog() {
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

export function getCachedPlatformCatalog() {
    return cache
}
