package com.wxsted.reminthhud.client;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.stats.StatType;
import net.minecraft.stats.StatsCounter;

/**
 * Minecraft only saves your statistics (blocks mined, kills, deaths, time played...) for worlds on
 * THIS computer. On a server they live on the server, so Reminth's Player Statistics page could never
 * show them. The game can ask a server for the player's own statistics - it is what the Statistics
 * screen does - and this does the same, quietly, while you are on a server: about five seconds after
 * joining and then every thirty seconds, it asks, waits a moment, and saves the answer to
 * .reminth/server-stats/&lt;server&gt;.json in the instance (the same layout as a world's stats file).
 *
 * Nothing is sent anywhere but to the server you are already playing on, and the file stays on this
 * computer. Singleplayer is skipped (the world's own file already counts). A server that sends
 * nothing back (some minigame networks keep no vanilla statistics) simply leaves no file.
 */
final class ServerStats {
	private static final int FIRST_ASK_TICKS = Integer.getInteger("reminthhud.statsFirst", 100);
	private static final int EVERY_TICKS = Integer.getInteger("reminthhud.statsEvery", 600);
	private static final int WAIT_TICKS = 60;
	// Test only (-Dreminthhud.statsTest=true): also ask the built-in server of a singleplayer world.
	private static final boolean TEST = Boolean.getBoolean("reminthhud.statsTest");

	private static String server = null; // null: not on a server we record
	private static int ticks = 0;
	private static int waiting = 0; // ticks left until the answer is read; 0: not waiting
	private static int lastTotal = -1;

	private ServerStats() {
	}

	static void init() {
		ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
			server = serverName(client);
			ticks = 0;
			waiting = 0;
			lastTotal = -1;
		});
		ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
			server = null;
			waiting = 0;
		});
		ClientTickEvents.END_CLIENT_TICK.register(ServerStats::tick);
	}

	/** A file-name-safe name for the server the player is on, or null for singleplayer and LAN games. */
	private static String serverName(Minecraft client) {
		try {
			ServerData data = client.getCurrentServer();
			if (client.getSingleplayerServer() != null) {
				return TEST ? "singleplayer-test" : null;
			}
			if (data == null || data.isLan() || data.ip == null || data.ip.isBlank()) {
				return null;
			}
			String name = data.ip.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]", "_");
			return name.length() > 80 ? name.substring(0, 80) : name;
		} catch (Throwable t) {
			return null;
		}
	}

	private static void tick(Minecraft client) {
		if (server == null || client.player == null || client.level == null || client.getConnection() == null) {
			return;
		}
		try {
			if (waiting > 0) {
				if (--waiting == 0) {
					save(client);
				}
				return;
			}
			ticks++;
			if (ticks == FIRST_ASK_TICKS || (ticks > FIRST_ASK_TICKS && (ticks - FIRST_ASK_TICKS) % EVERY_TICKS == 0)) {
				client.getConnection().send(new ServerboundClientCommandPacket(ServerboundClientCommandPacket.Action.REQUEST_STATS));
				waiting = WAIT_TICKS;
			}
		} catch (Throwable t) {
			ReminthHud.LOGGER.info("ReminthHUD: server statistics stopped ({})", t.toString());
			server = null;
		}
	}

	private static void save(Minecraft client) throws Exception {
		StatsCounter counter = client.player.getStats();
		JsonObject stats = new JsonObject();
		int total = 0;
		for (StatType<?> type : BuiltInRegistries.STAT_TYPE) {
			total += collect(type, counter, stats);
		}
		if (total == 0) {
			return; // the server sent nothing
		}
		File dir = new File(client.gameDirectory, ".reminth/server-stats");
		Path file = new File(dir, server + ".json").toPath();
		// A server can answer with less than before (a lobby or another world has its own counters): never let a
		// saved number go down, keep the larger value of every counter.
		stats = keepLargest(stats, file, client.player.getUUID().toString());
		total = 0;
		for (var type : stats.entrySet()) {
			for (var e : type.getValue().getAsJsonObject().entrySet()) {
				total += e.getValue().getAsInt();
			}
		}
		if (total == lastTotal) {
			return; // nothing changed
		}
		lastTotal = total;
		JsonObject root = new JsonObject();
		root.add("stats", stats);
		root.addProperty("server", server);
		root.addProperty("uuid", client.player.getUUID().toString());
		root.addProperty("savedAt", System.currentTimeMillis());
		Files.createDirectories(dir.toPath());
		Path tmp = new File(dir, server + ".json.tmp").toPath();
		Files.writeString(tmp, root.toString(), StandardCharsets.UTF_8);
		Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
	}

	/** The new counters, with every counter that was higher in the earlier file (same player) kept at its higher value. */
	private static JsonObject keepLargest(JsonObject fresh, Path file, String uuid) {
		try {
			if (!Files.exists(file)) {
				return fresh;
			}
			JsonObject old = new JsonParser().parse(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
			if (!old.has("uuid") || !uuid.equals(old.get("uuid").getAsString()) || !old.has("stats")) {
				return fresh;
			}
			for (var type : old.getAsJsonObject("stats").entrySet()) {
				JsonObject target = fresh.has(type.getKey()) ? fresh.getAsJsonObject(type.getKey()) : new JsonObject();
				for (var e : type.getValue().getAsJsonObject().entrySet()) {
					int before = e.getValue().getAsInt();
					if (!target.has(e.getKey()) || target.get(e.getKey()).getAsInt() < before) {
						target.addProperty(e.getKey(), before);
					}
				}
				fresh.add(type.getKey(), target);
			}
		} catch (Throwable t) {
			// an unreadable old file: just write the new numbers
		}
		return fresh;
	}

	/** Adds this type's non-zero counters as {"minecraft:mined": {"minecraft:stone": 12}}; returns their sum. */
	private static <T> int collect(StatType<T> type, StatsCounter counter, JsonObject out) {
		Registry<T> values = type.getRegistry();
		JsonObject one = new JsonObject();
		int sum = 0;
		for (T value : values) {
			int n = counter.getValue(type.get(value));
			if (n > 0) {
				one.addProperty(values.getKey(value).toString(), n);
				sum += n;
			}
		}
		if (sum > 0) {
			out.add(BuiltInRegistries.STAT_TYPE.getKey(type).toString(), one);
		}
		return sum;
	}
}
