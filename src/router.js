'use strict';
// Tiny router: '/rfqs/:id/edit' style patterns. ':id' only matches digits.

class Router {
  constructor() { this.routes = []; }

  on(method, pattern, handler, opts = {}) {
    const keys = [];
    const src = pattern.split('/').map((seg) => {
      if (seg.startsWith(':')) {
        const key = seg.slice(1);
        keys.push(key);
        return key === 'id' ? '(\\d+)' : '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    this.routes.push({ method, re: new RegExp(`^${src}/?$`), keys, handler, opts });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.re.exec(pathname);
      if (!m) continue;
      const params = Object.create(null);
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return null;
  }
}

module.exports = { Router };
