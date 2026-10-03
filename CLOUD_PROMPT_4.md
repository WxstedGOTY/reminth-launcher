# Prompt 4 for the code-writing window: the mod detail page in Discover

Send AFTER Prompt 3 is finished and pushed (Opus 5.5, effort high). It is deliberately a separate prompt: it is a big
feature and should have the window's full attention.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after each batch (it must stay
green), commit after each finished step, push to main at the end, then rewrite DECISIONS_AND_TEST_PLAN.md as
CLAUDE.md says. Do NOT build, do NOT bump the version, do NOT touch the performance-pack code or the
privacy/terms text (if this feature needs a new sentence there, list the exact sentence in the hand-off file for
the desktop window).

=== THE FEATURE: click a card in Discover, see the whole project ===
In Discover (mods, modpacks, resource packs, data packs, shaders) every result card gets a blue outline on hover
but clicking does nothing. Modrinth has a full page per project: the long description with the author's rules
and explanations, gallery, links, license, versions. Reminth must show that inside the launcher.

Already there: the IPC catalog:project (main.js) returns modrinth.getProject(idOrSlug) - the full project
(body markdown, gallery, links, license, team ids, loaders, game_versions...). Modrinth's version list is
modrinth.getProjectVersions. There is NO markdown renderer, and the renderer has a strict CSP: img-src allows only
'self', file:, data:, https://cdn.modrinth.com and https://avatars.githubusercontent.com; connect-src 'none'.

1. Clicking a card (anywhere except the Install button and the chevron next to it) opens a detail view INSIDE
   Discover with a Back button. Back restores the search text, filters, page and scroll position exactly.
   Esc and the mouse "back" button also go back. Keyboard: cards must be focusable and Enter opens them.
   Also open it from other places that show a project (installed-mod rows with a known projectId, the
   "suggested mods" list) if that is a small addition; otherwise leave those out and say so.
2. The detail view shows, from the data the main process fetches (one IPC, e.g. catalog:projectPage, that returns
   the project + the team members + the latest versions in one go, cached for a few minutes, with Modrinth's
   rate-limit rules respected through modrinth.js):
   - header: icon, title, summary, author(s) with their avatar (avatars only from allowed hosts), download and
     follower counts, last updated, categories, client/server side, license name;
   - the supported loaders and Minecraft versions (collapsed to ranges, not 300 chips), and a clear "Fits your
     instance" / "No build for <version> <loader> yet" line for the instance picked in Discover's instance
     picker (reuse compat.projectSupport and the existing hints);
   - tabs: Description (the long text), Gallery, Versions (name, channel Release/Beta/Alpha, game versions,
     loaders, date, downloads; changelog on expand), Links;
   - links: source, issues, wiki, Discord, donation (only those that exist) and "View on Modrinth".
   - the Install button (same behaviour, same instance/kind rules, same running-instance guard as the cards -
     read how JOB 2 of Prompt 3 blocks mod changes in a running instance and follow it), and for a version row
     an "Install this version" that respects "never install alpha/beta silently": a Beta/Alpha row needs an
     explicit second confirmation that names the channel.
   - credit the author and say plainly "Description by the project's author, shown from Modrinth."
3. THE DESCRIPTION RENDERER (the hard part - take your time, write it as its own module, e.g.
   src/renderer/markdown.js, loaded as a classic script like the others, with its own tests that run under
   node --test by making the parser pure and DOM-free: it returns a small tree of plain objects, a thin function
   turns the tree into DOM with el()/textContent):
   - Modrinth bodies are Markdown with some inline HTML (<img>, <a>, <p align="center">, <details>, <br>, <h1>-<h6>,
     <kbd>, <b>, <i>, <code>, tables). Support: headings, paragraphs, bold/italic/strike, inline code, fenced code
     blocks, block quotes, ordered/unordered/nested lists, task lists, tables, horizontal rules, links, images,
     line breaks, <details>/<summary>, centered paragraphs. Everything else is shown as plain text, never
     dropped silently and never interpreted.
   - NEVER innerHTML / insertAdjacentHTML / outerHTML / DOMParser into the page / document.write / eval /
     inline event attributes / style attributes from the text. Build elements with el() and textContent only. An
     unknown tag becomes its text. All attribute values are checked (see below).
   - Links: only https: (and mailto: is NOT allowed). Show the real address on hover (title). A click opens the
     DEFAULT BROWSER through one fixed main-process IPC that re-validates the URL (https only, no credentials in
     the URL, length cap), never inside the launcher window, never a new Electron window. Link text that looks
     like a different address than its target (text "modrinth.com" -> evil.example) shows the real host in
     brackets next to it.
   - Images: ONLY from https://cdn.modrinth.com (and the avatar host) - everything else is NOT loaded, because
     loading a picture from a random site tells that site the player's IP address (privacy rule: the launcher
     contacts only the services listed in the privacy policy). Show a small placeholder box "Image hosted
     elsewhere" with an "Open in browser" link instead. Never add other hosts to the CSP. Give every image
     alt text, a max width, lazy loading (loading="lazy" via the attribute is fine), and a size cap.
   - YouTube / video embeds are not played: show a link card "Video - opens in your browser".
   - Cap the work: a body over ~200 KB is cut with "Read the rest on Modrinth" (link), nesting depth capped,
     table size capped, so a hostile description can't freeze the launcher. The parse runs in chunks or is
     capped so one huge description cannot block the UI for more than a frame or two.
   - Security tests (must exist): script/iframe/object/style tags, onerror/onclick attributes, javascript:/data:/
     file: links, protocol-relative URLs, links with credentials, images from other hosts, a huge nested list,
     unclosed tags, a body of 5 MB. For each, assert what the tree/DOM contains.
4. Look: match the app's existing style (read styles.css; the last rule stays last; CRLF stays CRLF; no
   glassmorphism-style clutter, transitions under 200 ms). Mobile-width is not a concern, but the layout must work
   from 1100 px up. Dark theme only like the rest. The description column has a readable line length.
5. Performance and states: skeleton while loading, a plain error with Retry if Modrinth can't be reached
   (friendlyError), the Back button works while it loads, stale results are ignored if the player already went
   back or opened another project (capture the project id at click time, compare when the answer arrives).
6. Tests: markdown parser (syntax + all the security cases above), the link/image allow rules, the
   "fits your instance" decision, version-row channel rules. Existing tests stay green unchanged.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, decisions, a numbered
PASS/FAIL plan for the desktop window including: open Fabric API, Sodium, Iris, Entity Culling, a modpack, a
shader and a resource pack; a description with images and tables; a link opens the default browser; a
non-Modrinth image shows the placeholder), and tell me (a) what you could not test, (b) every file you touched,
(c) anything you decided differently and why.
```
