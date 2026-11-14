(() => {
  'use strict';

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set || Element.prototype.__newsAppendOnlyFeedV913811) return;

  Object.defineProperty(Element.prototype, '__newsAppendOnlyFeedV913811', {
    value: true,
    configurable: false
  });

  const previousGet = descriptor.get;
  const previousSet = descriptor.set;

  function articleChildren(root) {
    return [...root.children].filter(node => node.matches?.('.article-card[data-article]'));
  }

  function ids(cards) {
    return cards.map(card => String(card.dataset.article || ''));
  }

  function isStrictExtension(oldIds, newIds) {
    if (!oldIds.length || newIds.length <= oldIds.length) return false;
    for (let i = 0; i < oldIds.length; i += 1) {
      if (!oldIds[i] || oldIds[i] !== newIds[i]) return false;
    }
    return true;
  }

  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() { return previousGet.call(this); },
    set(value) {
      const text = typeof value === 'string' ? value : '';
      const isFeed = this.classList?.contains('feed');
      const currentCards = isFeed ? articleChildren(this) : [];

      // feedly-runtime rebuilds the complete Home feed whenever the automatic
      // "load more" limit increases. On Android this made every already loaded
      // photo disappear and reappear at once. Detect the strict-superset case
      // and append only the genuinely new rows, preserving existing DOM nodes,
      // images, grey state and scroll geometry.
      if (isFeed && currentCards.length && text.includes('article-card') && text.includes('data-article=')) {
        const template = document.createElement('template');
        previousSet.call(template, text);
        const nextCards = articleChildren(template.content);
        const oldIds = ids(currentCards);
        const newIds = ids(nextCards);

        if (isStrictExtension(oldIds, newIds)) {
          this.querySelector(':scope > [data-home-more]')?.remove();
          for (const card of nextCards.slice(currentCards.length)) this.appendChild(card);
          const nextMore = template.content.querySelector(':scope > [data-home-more]');
          if (nextMore) this.appendChild(nextMore);
          return;
        }
      }

      previousSet.call(this, value);
    }
  });
})();
