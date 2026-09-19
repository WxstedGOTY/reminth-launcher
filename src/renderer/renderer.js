"use strict";

const $ = (id) => document.getElementById(id);

$("minBtn").onclick = () => window.reminth.minimize();
$("closeBtn").onclick = () => window.reminth.close();

function showSignedIn(username) {
  $("signedOutPanel").hidden = true;
  $("mainPanel").hidden = false;
  $("username").textContent = username;
}

function showSignedOut() {
  $("mainPanel").hidden = true;
  $("signedOutPanel").hidden = false;
  $("codePanel").hidden = true;
  $("signInBtn").hidden = false;
  $("signInBtn").disabled = false;
}

$("signInBtn").onclick = async () => {
  $("signInBtn").disabled = true;
  try {
    const { username } = await window.reminth.signIn();
    showSignedIn(username);
  } catch (err) {
    $("codePanel").hidden = true;
    $("signInBtn").hidden = false;
    $("signInBtn").disabled = false;
    appendLog("Sign-in failed: " + friendlyError(err.message), true);
  }
};

/**
 * Translates the handful of raw errors a confused/non-technical player is
 * most likely to actually hit into plain language. Everything else (rare,
 * usually a real bug) falls through unchanged rather than being guessed at.
 */
function friendlyError(message) {
  if (/Invalid app registration/i.test(message)) {
    return (
      "Sign-in almost worked, but Microsoft hasn't finished approving Reminth's app yet " +
      "(a one-time review on their side). This isn't a problem with your account - try again later."
    );
  }
  if (/Checksum mismatch/i.test(message)) {
    return (
      "A downloaded file didn't match what was expected. Click Download / update files again - " +
      "if it keeps happening, something between you and the server (VPN, proxy, or firewall) may be altering downloads."
    );
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return "Couldn't reach Microsoft/Mojang's servers. Check your internet connection and try again.";
  }
  return message;
}

$("signOutBtn").onclick = async () => {
  await window.reminth.signOut();
  showSignedOut();
};

$("playBtn").onclick = async () => {
  $("playBtn").disabled = true;
  $("progressWrap").hidden = false;
  $("log").hidden = false;
  $("log").textContent = "";
  try {
    await window.reminth.play();
  } catch (err) {
    appendLog("Couldn't launch: " + friendlyError(err.message), true);
  } finally {
    $("playBtn").disabled = false;
  }
};

// Downloading/updating the Fabric+ReminthHUD files is public and needs no
// sign-in, so it's available from either panel - useful for pre-caching,
// repairing an install, or just checking everything still resolves.
$("updateBtnOut").onclick = () => runUpdate("Out");

async function runUpdate(suffix) {
  const btn = suffix === "Out" ? $("updateBtnOut") : null;
  if (btn) btn.disabled = true;
  $("progressWrap" + suffix).hidden = false;
  $("log" + suffix).hidden = false;
  $("log" + suffix).textContent = "";
  try {
    await window.reminth.install();
  } catch (err) {
    appendLog("Update failed: " + friendlyError(err.message), true, suffix);
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.reminth.onAccountRestored(({ username }) => showSignedIn(username));

window.reminth.onAuthCode(({ userCode, verificationUri }) => {
  $("signInBtn").hidden = true;
  $("codePanel").hidden = false;
  $("userCode").textContent = userCode;
  $("verificationLink").href = verificationUri;
  $("verificationLink").textContent = verificationUri.replace(/^https?:\/\//, "");
});

window.reminth.onAuthWaiting(() => {
  $("codeHint").textContent = "Waiting for sign-in…";
});

window.reminth.onInstallProgress(({ stage, current, total }) => {
  const suffix = $("mainPanel").hidden ? "Out" : "";
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  // Show the percentage next to the stage name (not just the fill bar's
  // width) - a silent bar with no number reads as "frozen" to someone who
  // isn't used to launcher installs, especially during the multi-hundred-MB
  // asset download on a first run.
  $("progressStage" + suffix).textContent = total > 1 ? `${stage} — ${pct}%` : stage;
  $("progressFill" + suffix).style.width = pct + "%";
  appendLog(`${stage}${total > 1 ? ` (${current}/${total})` : ""}`, false, suffix);
});

window.reminth.onInstallDone(() => {
  const suffix = $("mainPanel").hidden ? "Out" : "";
  $("progressStage" + suffix).textContent = "Done";
  $("progressFill" + suffix).style.width = "100%";
});

// Fires if the actual Java/Minecraft process dies shortly after launch -
// see minecraft.js's launch(). Without this, a crash-on-startup was
// completely invisible: the launcher already told the player "launched"
// before the game process finished failing.
window.reminth.onPlayCrashed(({ code, signal, error, logPath }) => {
  const reason = error
    ? error
    : signal
    ? `the game process was killed (${signal})`
    : `the game process exited immediately (code ${code})`;
  appendLog(
    `Minecraft closed right after launching - ${reason}. Full log: ${logPath}`,
    true
  );
});

function appendLog(line, isError, suffix) {
  const el = $("log" + (suffix || ""));
  el.hidden = false;
  el.textContent += (isError ? "! " : "") + (line.endsWith("\n") ? line : line + "\n");
  el.scrollTop = el.scrollHeight;
}
