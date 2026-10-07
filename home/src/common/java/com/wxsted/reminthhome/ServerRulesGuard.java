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
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Before the game connects to a server whose rules ban a mod that is switched on, it asks first ("Join anyway" /
 * "Back"). Reminth writes the list at every launch (config/reminth-server-rules.json, from the launcher's
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
	/** Servers the player said "Join anyway" for (this run), or in the launcher's own warning. */
	private static final Set<String> allowed = new HashSet<>();

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
	 * True when the connection must wait: the question is on screen, and {@code proceed} connects if the player says
	 * "Join anyway". {@code parent} is where "Back" goes.
	 */
	public static boolean shouldStop(String host, Runnable proceed, Screen parent) {
		try {
			Server s = serverFor(host);
			if (s == null || allowed.contains(s.id())) return false;
			List<Mod> on = new ArrayList<>();
			for (Mod m : s.mods()) if (FabricLoader.getInstance().isModLoaded(m.id())) on.add(m);
			if (on.isEmpty()) return false;
			StringBuilder text = new StringBuilder();
			text.append(s.name()).append("'s rules ban ").append(on.size() == 1 ? "this mod" : "these mods").append(" - you can get banned:\n\n");
			for (Mod m : on) text.append(m.title()).append(" (").append(m.why()).append(")\n");
			text.append("\nTurn ").append(on.size() == 1 ? "it" : "them").append(" off in Reminth before you join (it doesn't delete anything).");
			if (!s.source().isEmpty()) text.append("\nSource: ").append(s.source()).append('.');
			Minecraft mc = Minecraft.getInstance();
			Screen ask = new ConfirmScreen(yes -> {
				if (yes) {
					allowed.add(s.id());
					proceed.run();
				} else {
					Compat.setScreen(mc, parent);
				}
			}, Component.literal("These mods can get you banned on " + s.name()), Component.literal(text.toString()),
					Component.literal("Join anyway"), Component.literal("Back"));
			mc.execute(() -> Compat.setScreen(mc, ask));
			return true;
		} catch (Throwable t) {
			ReminthHomeClient.LOG.warn("Reminth: the server rules check failed, joining anyway ({})", t.toString());
			return false;
		}
	}
}
