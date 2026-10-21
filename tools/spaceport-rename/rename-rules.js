// The visible-name rules (owner, 16 Oct 2026: Reminth -> Spaceport Launcher). Applied to user-visible text only.
// Formal spots get "Spaceport Launcher"; running sentences and product names get "Spaceport".
function apply(t) {
  return t
    .replace(/ReminthHUD/g, "Spaceport HUD")
    .replace(/Reminth HUD/g, "Spaceport HUD")
    .replace(/Reminth home screen/g, "Spaceport home screen")
    .replace(/Reminth Home Screen/g, "Spaceport Home Screen")
    .replace(/Reminth Mods Panel/g, "Spaceport Mods Panel")
    .replace(/Reminth panel/g, "Spaceport panel")
    .replace(/Reminth\+/g, "Spaceport+")
    .replace(/Reminth accounts/g, "Spaceport accounts")
    .replace(/Reminth account/g, "Spaceport account")
    .replace(/Welcome to Reminth\b/g, "Welcome to Spaceport Launcher")
    .replace(/Reminth Launcher/g, "Spaceport Launcher")
    // "Reminth 1.8.0", "Reminth " + version: the product with its version
    .replace(/(^|["'`>\s(])Reminth(?= (?:\d|["'`]|\$\{|<))/g, "$1Spaceport Launcher")
    .replace(/\bReminth\b/g, "Spaceport");
}
module.exports = { apply };
