package com.wxsted.reminthhome;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * When the game connects to a server whose rules ban a mod that is switched on, one small grey chat line says so
 * after joining - nothing stops the join and nothing is turned off (owner, 8 Oct 2026: "just add a small warning";
 * it used to be a "Join anyway / Back" screen). Reminth writes the list at every launch (config/reminth-server-rules.json, from the launcher's
 * serverRules.js: DonutSMP, Hypixel, MCC Island, each with its source). Every way of joining goes through
 * ConnectScreen.startConnecting, which the per-version ConnectGuardMixin hands to {@link #shouldStop}.
 * Anything unreadable or unexpected lets the connection go ahead - this never stands in the way of playing.
 */
public final class ServerRulesGuard {
	private ServerRulesGuard() {
	}

	private record Mod(String id, String title, String why) {
	}

	private record Server(String id, String name, List<String> hosts, List<Mod> mods, String source) {
	}

	private static List<Server> servers;
	/** Servers already warned about (this run), or in the launcher's own warning. */
	private static final Set<String> allowed = new HashSet<>();
	/** The chat line to show once the player is in the server. */
	private static volatile Component pending;

	private static synchronized List<Server> load() {
		if (servers != null) return servers;
		List<Server> out = new ArrayList<>();
		try {
			Path p = FabricLoader.getInstance().getConfigDir().resolve("reminth-server-rules.json");
			if (Files.exists(p)) {
				JsonObject root = JsonParser.parseString(Files.readString(p)).getAsJsonObject();
				JsonArray list = root.getAsJsonArray("servers");
				for (JsonElement e : list) {
					JsonObject s = e.getAsJsonObject();
					List<String> hosts = new ArrayList<>();
					for (JsonElement h : s.getAsJsonArray("hosts")) hosts.add(h.getAsString().toLowerCase(Locale.ROOT));
					List<Mod> mods = new ArrayList<>();
					for (JsonElement m : s.getAsJsonArray("mods")) {
						JsonObject o = m.getAsJsonObject();
						mods.add(new Mod(o.get("id").getAsString(), o.get("title").getAsString(), o.get("why").getAsString()));
					}
					String id = s.get("id").getAsString();
					if (s.has("accepted") && s.get("accepted").getAsBoolean()) allowed.add(id);
					out.add(new Server(id, s.get("name").getAsString(), hosts, mods, s.has("source") ? s.get("source").getAsString() : ""));
				}
			}
		} catch (Throwable t) {
			ReminthHomeClient.LOG.warn("Reminth: couldn't read the server rules list ({})", t.toString());
		}
		servers = out;
		return servers;
	}

	private static Server serverFor(String host) {
		if (host == null) return null;
		String h = host.trim().toLowerCase(Locale.ROOT);
		while (h.endsWith(".")) h = h.substring(0, h.length() - 1);
		for (Server s : load()) {
			for (String known : s.hosts()) {
				if (h.equals(known) || h.endsWith("." + known)) return s;
			}
		}
		return null;
	}

	/**
	 * Never stops the connection any more (always false): notes a small warning to show in chat once joined, the
	 * first time this run that this server is joined with one of its banned mods on. {@code proceed} and {@code parent}
	 * are kept so the per-version ConnectGuardMixin doesn't change.
	 */
	public static boolean shouldStop(String host, Runnable proceed, Screen parent) {
		try {
			Server s = serverFor(host);
			if (s == null || allowed.contains(s.id())) return false;
			List<String> on = new ArrayList<>();
			for (Mod m : s.mods()) if (FabricLoader.getInstance().isModLoaded(m.id())) on.add(m.title());
			if (on.isEmpty()) return false;
			allowed.add(s.id());
			pending = Component.literal("[Reminth] Heads-up: " + s.name() + "'s rules ban " + String.join(", ", on) + ".").withStyle(ChatFormatting.GRAY);
		} catch (Throwable t) {
			ReminthHomeClient.LOG.warn("Reminth: the server rules check failed ({})", t.toString());
		}
		return false;
	}

	/** Every tick (CursorFix): shows the waiting warning once the player is in the server. */
	static void tick(Minecraft mc) {
		Component c = pending;
		if (c == null || mc.player == null) return;
		pending = null;
		try {
			Compat.say(mc, c);
		} catch (Throwable ignored) {
			// a warning is never worth an error
		}
	}
}
