# Prompt 14 for the code-writing window: the server ping shows ~80 ms where other launchers show ~30 ms

Model: Sonnet 5.5, effort medium. Small, self-contained (src/main/serverPing.js + tests). Send when the desktop window is idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron or reach real servers: say plainly what you could not test. npm test, commit,
push to main, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Touch only src/main/serverPing.js and
test files (and the one line of text in the renderer that explains the number, if there is one).

=== THE PROBLEM (owner report, measured in the real app) ===
Reminth shows ~80 ms for a server where the game's own multiplayer list and other launchers show ~30 ms.
Cause (read serverPing.js ping()): the number is Date.now() taken from just after the handshake is written to
the moment the STATUS RESPONSE (packet 0x00 with the big JSON: MOTD, favicon, player sample) has fully arrived.
That time includes the server building and sending that JSON (a proxy such as Velocity/BungeeCord may even ask a
backend server first) - it is not the network round trip. The game itself shows the time of the PING/PONG
packets that come AFTER the status response.

=== THE FIX ===
 1. Do what the vanilla server list does: after the status response (id 0x00) has been read, send a Ping Request
    (packet id 0x01 in the Status state, payload = one 8-byte big-endian long: any number, e.g. the current time)
    and measure the time until the Pong Response (id 0x01, the same 8 bytes echoed). That round trip is the ping.
    Use process.hrtime.bigint() / performance.now() (sub-millisecond), not Date.now().
 2. Make the number steady: send up to 3 Ping Requests one after another on the same connection (each only after
    the previous Pong arrived), and report the MEDIAN of the Pongs that came back, rounded to whole ms (minimum
    1). If only some answered before the overall timeout, use what you have; if none did, fall back to the old
    status-response time and flag it (latencyKind: "status") so nothing breaks on servers that never answer a
    ping. Normal case latencyKind: "ping".
 3. Keep every existing guarantee: the single `finish` exit, the overall timeout (TIMEOUT_MS) covering ALL of it
    (status + pings), no leaked sockets or timers, SRV lookup time NOT included, max response size, the
    result shape ({ online, playersOnline, playersMax, latencyMs, version, versionName, protocol } plus the new
    latencyKind). The public ping() signature does not change. The server rows and tooltips that show
    latencyMs keep working untouched.
 4. Tests with a FAKE server on a local TCP port inside the test (node:net): (a) a normal server answering status
    then pongs -> latencyMs is the pong time, not the status time (make the fake server wait 120 ms before
    sending the status JSON and answer pings immediately; assert the reported latency is well below 120);
    (b) a server that never answers pings -> falls back to the status time with latencyKind "status";
    (c) pongs with a wrong payload are ignored; (d) the connection closing mid-way finishes once; (e) three
    pings -> median (script the fake server's delays 10/40/20 ms and assert ~20). Keep the existing serverPing
    tests green unchanged.
 5. In the renderer, where a ping value is explained to the player (tooltip or note), say plainly: "Your
    connection's round trip to the server, measured the way Minecraft's own server list does." Only if such a
    text already exists - do not add new UI.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, a PASS/FAIL step for the
desktop window: compare Reminth's number for a real server with Minecraft's own multiplayer list and with the
ping you see in the game's player list; they should agree within a few ms), and tell me (a) what you could
not test, (b) every file you touched.
```
