"use strict";
/**
 * reminth:// links. The game's title screen (the bundled "reminthhome" mod)
 * can't change a skin itself, so its Skins button asks Windows to open
 * reminth://skins, which brings Reminth to the front on its Skins page.
 *
 * A link can come from anywhere - a web page, a chat message - so it can
 * ONLY switch the page. Never play, install, delete, download, sign out or
 * send anything. The allow-list is strict:
 *
 *   reminth://skins             -> { page: "skins" }
 *   reminth://home              -> { page: "home" }
 *   reminth://instance/<id>     -> { page: "instance", id }   (an instance that exists)
 *
 * (one trailing "/" is allowed: Windows and browsers often add one). Any
 * other scheme or case, another host, an extra path, a query or fragment,
 * percent-escapes, control characters, "..", or anything long is null and
 * is ignored without a word. Pure, apart from the handler at the bottom,
 * which only gets the two things it may do passed in.
 */

const SCHEME = "reminth:";
const MAX_LINK_LENGTH = 120;
// Instance ids as instances.js makes them: a slug of at most 32 + "-" + 4 hex.
const INSTANCE_ID = /^[a-z0-9-]{1,40}$/;

/** Pure: one link string -> { page, id? } or null. `knownIds`: the instances that exist. */
function parseLink(text, knownIds) {
  if (typeof text !== "string" || text.length > MAX_LINK_LENGTH) return null;
  if (!text.startsWith(SCHEME + "//")) return null; // exact, lower-case scheme
  // Only these characters anywhere: no spaces, controls, %, ?, #, \, ., :, @...
  if (!/^reminth:\/\/[a-z0-9/-]+$/.test(text)) return null;
  let rest = text.slice((SCHEME + "//").length);
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  if (rest === "skins") return { page: "skins" };
  if (rest === "home") return { page: "home" };
  const m = /^instance\/([a-z0-9-]+)$/.exec(rest);
  if (m && INSTANCE_ID.test(m[1]) && !/^-|-$/.test(m[1])) {
    const ids = knownIds instanceof Set ? knownIds : new Set(Array.isArray(knownIds) ? knownIds : []);
    return ids.has(m[1]) ? { page: "instance", id: m[1] } : null;
  }
  return null;
}

/**
 * Pure: the link in a command line (process.argv, or the argv of the
 * "second-instance" event) or a single string, or null. Every other
 * argument (the exe, "--some-flag", "--user-data-dir=...", ".") is
 * ignored. More than one reminth: argument is null - nothing to guess.
 */
function parseDeepLink(argvOrString, { knownIds = [] } = {}) {
  const args = typeof argvOrString === "string" ? [argvOrString] : Array.isArray(argvOrString) ? argvOrString : [];
  if (args.length > 64) return null;
  const links = args.filter((a) => typeof a === "string" && a.slice(0, SCHEME.length).toLowerCase() === SCHEME);
  if (links.length !== 1) return null;
  return parseLink(links[0], knownIds);
}

/**
 * The handler main.js wires to the first start and to "second-instance".
 * deps (nothing else is reachable from here):
 *   listIds()        -> the instance ids that exist (may be a promise)
 *   bringForward()   -> shows the window (main.js decides how, given a game)
 *   showPage(link)   -> tells the page which page to show
 * Returns the link it acted on, or null. Never throws.
 */
function createDeepLinkHandler({ listIds, bringForward, showPage }) {
  return async function handle(argvOrString) {
    try {
      const args = typeof argvOrString === "string" ? [argvOrString] : argvOrString;
      // Only ask for the instance list when there is a link at all.
      if (!(Array.isArray(args) && args.some((a) => typeof a === "string" && a.slice(0, SCHEME.length).toLowerCase() === SCHEME))) return null;
      const link = parseDeepLink(args, { knownIds: await listIds() });
      if (!link) return null;
      bringForward();
      showPage(link);
      return link;
    } catch {
      return null;
    }
  };
}

module.exports = { parseDeepLink, parseLink, createDeepLinkHandler, MAX_LINK_LENGTH };
