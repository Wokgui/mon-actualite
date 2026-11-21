(() => {
  const nativeFetch = window.fetch.bind(window);
  let startupNewsRequestHandled = false;

  function newsRequestUrl(input) {
    try {
      return new URL(typeof input === 'string' ? input : input?.url || '', location.href);
    } catch {
      return null;
    }
  }

  function requestInterests(url, init) {
    const fromQuery = String(url?.searchParams?.get('interests') || '').trim();
    if (fromQuery) return fromQuery;
    try {
      if (typeof init?.body !== 'string') return '';
      const body = JSON.parse(init.body);
      return Array.isArray(body?.preferredCategories)
        ? body.preferredCategories.map(String).filter(Boolean).join(',')
        : '';
    } catch {
      return '';
    }
  }

  window.fetch = async function fastStartupFetch(input, init) {
    const url = newsRequestUrl(input);
    const isNewsRequest = url && url.origin === location.origin && url.pathname === '/api/news';
    if (!startupNewsRequestHandled && isNewsRequest) {
      startupNewsRequestHandled = true;
      const interests = requestInterests(url, init);
      const fastUrl = new URL('/api/news-fast', location.origin);
      if (interests) fastUrl.searchParams.set('interests', interests);

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3200);
      try {
        const fastResponse = await nativeFetch(fastUrl.href, {
          method: 'GET',
          cache: 'default',
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (fastResponse.ok) return fastResponse;
      } catch {
        // Fall through to the complete synchronisation if the fast catalogue
        // is exceptionally unavailable.
      } finally {
        window.clearTimeout(timer);
      }
    }
    return nativeFetch(input, init);
  };
})();
