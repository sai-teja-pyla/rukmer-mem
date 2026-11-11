# Rukmer browser extension

One Manifest V3 package for Chrome, Edge, and Brave. It saves only what you turn on, into your existing Rukmer memory, using the same document and search APIs as the app.

Nothing is captured until you finish setup and enable a feature. The extension does not run in private windows.

## Build

```bash
cd extension
npm install
npm run zip
```

The unpacked folder is `extension/dist`. The store package is `extension/dist/rukmer-browser.zip`. Upload that zip to the Chrome Web Store. Edge Add-ons accepts the same zip. Brave installs Chrome Web Store extensions.

## Load unpacked

1. Build with the commands above.
2. Open the browser's extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn on Developer mode.
4. Choose Load unpacked and select the `extension/dist` folder.
5. Pin Rukmer. Open the popup and choose Connect. That opens app.rukmer.com/connectors. Click **Connect this browser**. You are already signed in, so there is no second login and no API key to copy. An API key is still there under “Use an API key instead” if you need it.

The icon is blue with ON while capture is on, amber with II while paused, and gray while capture is off or you are signed out.

## Try it

- Options: turn on Manual save. On a normal article, use Save this page, the right-click menu, or Ctrl/Cmd+Shift+S.
- Turn on Highlights, allow site access, select text, and use the Save button.
- Auto-capture stays off until you enable it. A page is saved only after it is the active tab for 30 seconds and you scroll.
- Search from the popup. Open the side panel from the extension's menu for related memories.
- Recent captures has Delete. That deletes the document in Rukmer too.
- Pause can be 1 hour, until tomorrow, or resume.

## Gmail, Canvas, and X

Each site is off until its Options toggle is on. Turning it on asks for access to that site only. Those sites are on the blocklist for every other feature.

- Gmail: open a message and use Save to Rukmer. Important-only auto-save is a second toggle. One-time codes, password resets, verification mail, and bank statements are skipped, and codes in the text are redacted. A reply updates the same thread.
- Canvas: Save to Rukmer appears on assignments, announcements, pages, modules, discussions, the syllabus, and the calendar. Grades and other students are skipped unless you enable Include grades. Set a custom Canvas domain in Options if the school does not use instructure.com.
- X: each post gets Save. Thread adds the author's connected replies as one document. Auto-save can watch likes and bookmarks. Direct messages stay off until X messages is enabled.

A small Saved to Rukmer toast includes Undo when a new document was created.

## Privacy

Tokens stay in `chrome.storage.local` inside the extension. Content scripts never see them. Saved URLs drop query parameters whose names look like tokens, keys, codes, sessions, or secrets. Pages with password or card fields, localhost, and `file://` URLs are not saved. Cookies and form values are not sent.

`alarms` is included so the offline queue can retry after the service worker sleeps. Bookmarks and history are optional permissions, requested only when you enable those features. Host access to pages is requested only when auto-capture, highlights, or a site toggle needs it. `https://app.rukmer.com/*` is required so the extension can reach the API.
