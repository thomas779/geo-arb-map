// Legacy-host redirect: 301 www.flagpaths.com and the pre-rename
// atlas.thomphreys.com to the canonical apex, preserving path + query so any
// shared deep links (and any early crawl equity) land on the right page.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'flagpaths.com';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
