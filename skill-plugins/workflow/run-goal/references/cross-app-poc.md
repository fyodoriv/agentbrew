# Cross-app proof of concept: lessons

Read this when a goal joins two apps, for example a host app that loads a widget
from a second app, with both running as local dev servers.

- **Prove the riskiest link first.** Load the second app inside the first before
  any polish. When a hosted page must load a local dev server, test that fetch
  from the page itself in the first probe. When a public or secure page fetches
  a loopback address, Chromium's Private Network Access can block it: the
  preflight response needs `Access-Control-Allow-Private-Network: true`. Newer
  Chromium may show a permission prompt instead. Some embedded browsers block
  loopback addresses outright.
- **Check the rendered page, not only the API.** After a doc tool reports
  success, open the rendered page. In one run, a markdown import kept
  whole-paragraph bold in the API read but did not render it. Headings fixed it.
- **A stuck automation browser.** When the shared automation browser stops
  answering mid-run, restart it through its service manager, then reopen your
  tabs. Earlier tab ids are gone after a restart.
- **End state.** Each draft PR embeds screenshots that load. Each question the
  goal asks has its answer under its own heading in the doc. The final message
  names the open browser tab and gives numbered test steps.
