package com.wxsted.reminthhud.client.panel;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.InputConstants;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

/**
 * The Reminth panel: Reminth's own client features (FPS, keystrokes, zoom...) with a Lunar-style window to switch them
 * on and off, set their options and move them around. Part of ReminthHUD, which Reminth always puts into Fabric/Quilt
 * instances. Opened with G (change it in Controls) or the title screen's Discover button.
 *
 * Settings: config/reminthhud-panel.json - {"active": "Default", "profiles": {"Default": {"fps": {"on": true, "anchor":
 * "TOP_LEFT", "dx": 4, "dy": 4, "scale": 1, "opts": {...}}, ...}}}. Anything unreadable falls back to the defaults
 * (the file is the player's; it is never deleted).
 */
public final class Panel {
	private Panel() {
	}

	public static final List<Module> MODULES = Features.all();
	private static final Map<String, JsonObject> profiles = new LinkedHashMap<>();
	public static String active = "Default";
	private static boolean ready = false;
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	private static KeyMapping openKey;
	private static KeyMapping zoomKey;
	private static KeyMapping snapKey;
	private static KeyMapping hideKey;
	private static int testOpenIn = Integer.getInteger("reminthhud.testOpenPanel", 0);
	private static final boolean testWatch = testOpenIn > 0;
	/** Hide HUD Key: every Reminth display hidden for a screenshot. */
	public static boolean hudHidden;

	public static KeyMapping hideKey() {
		return hideKey;
	}

	public static KeyMapping snapKey() {
		return snapKey;
	}

	public static KeyMapping zoomKey() {
		return zoomKey;
	}

	public static KeyMapping openKey() {
		return openKey;
	}

	/** `category`: the Controls category of ReminthHUD's keys (its type differs between Minecraft versions). */
	public static void init(Object category) {
		openKey = V.registerKey("key.reminthhud.panel", InputConstants.KEY_G, category);
		zoomKey = V.registerKey("key.reminthhud.zoom", InputConstants.KEY_C, category);
		snapKey = V.registerKey("key.reminthhud.snaplook", InputConstants.KEY_V, category);
		hideKey = V.registerKey("key.reminthhud.hidehud", InputConstants.KEY_F7, category);
		Features3.initTooltips();
		// Fullscreen Pointer: drawn on top of every menu
		net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> V.afterDraw(screen, g -> SoftCursor.draw(g, client)));
		Tips.init();
		TierTagger.registerCommand();
		load();
		ClientTickEvents.END_CLIENT_TICK.register(Panel::tick);
		V.registerHud(Panel::renderHud);
	}

	public static Module byId(String id) {
		for (Module m : MODULES) if (m.id.equals(id)) return m;
		return null;
	}

	public static Features.LowFire lowFire() {
		return (Features.LowFire) byId("lowfire");
	}

	public static Features.Zoom zoomFeature() {
		return (Features.Zoom) byId("zoom");
	}

	private static void tick(Minecraft mc) {
		try {
			if (!ready) {
				ready = true;
				for (Module m : MODULES) if (m.enabled) m.onEnable(mc);
			}
			// for Reminth's own game tests only (-Dreminthhud.testOpenPanel=90): opens the panel once, that many seconds
			// after the game started (the test tool can't press keys in every version)
			if (testOpenIn > 0 && java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() >= testOpenIn * 1000L) {
				testOpenIn = 0;
				if (!(V.screen(mc) instanceof PanelScreen)) open(V.screen(mc));
				ReminthHud.LOGGER.info("Reminth panel: test open -> {}", V.screen(mc));
			}
			if (testWatch && mc.level != null && mc.level.getGameTime() % 200 == 0) ReminthHud.LOGGER.info("Reminth panel: test screen {}", V.screen(mc));
			while (openKey.consumeClick()) {
				if (V.screen(mc) == null) open(null);
			}
			Features2.tick(mc);
			Features3.tick(mc);
			TierTagger.testTick(mc);
			for (Module m : MODULES) if (m.enabled) m.tick(mc);
		} catch (Throwable t) {
			ReminthHud.LOGGER.warn("Reminth panel: tick failed ({})", t.toString());
		}
	}

	/** Opens the panel; `parent` is where closing it goes back to (null: back to the game). */
	public static void open(Screen parent) {
		Minecraft mc = Minecraft.getInstance();
		V.setScreen(mc, new PanelScreen(parent));
	}

	/** For the home screen's Discover button (found by name: the home mod doesn't depend on this one). */
	public static void openFrom(Screen parent) {
		open(parent);
	}

	private static void renderHud(Gfx g) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null) return;
		if (V.debugShown(mc)) return;
		if (V.screen(mc) instanceof HudEditorScreen) return; // it draws them itself
		if (hudHidden) return;
		drawHud(g, mc, false);
	}

	/**
	 * Every switched-on HUD feature at its place. One still at its default place moves down (or up) to the next free
	 * space when an earlier one, or Xaero's minimap or the hotbar with hearts and hunger, is already there - so turning on many never
	 * piles them on top of each other. One the player moved stays exactly where they put it.
	 */
	static void drawHud(Gfx g, Minecraft mc, boolean preview) {
		int sw = g.guiWidth(), sh = g.guiHeight();
		List<int[]> taken = new ArrayList<>();
		if (MINIMAP) taken.add(new int[] {0, 0, 72, 72});
		taken.add(new int[] {sw / 2 - 92, sh - 52, sw / 2 + 92, sh}); // the game's hotbar, hearts, hunger and armor
		for (Module m : MODULES) if (m.enabled && m.isHud() && !m.atDefault()) taken.add(rect(m, m.screenX(sw), m.screenY(sh)));
		for (Module m : MODULES) {
			if (!m.enabled || !m.isHud()) continue;
			int x = m.screenX(sw), y = m.screenY(sh);
			if (m.atDefault()) {
				int h = Math.round(m.lastH * m.scale);
				int down = free(taken, x, y, m, sh, 1), up = free(taken, x, y, m, sh, -1);
				if (down >= 0 && (up < 0 || down - y <= y - up)) y = down;
				else if (up >= 0) y = up;
				taken.add(rect(m, x, y));
				if (h <= 0) taken.remove(taken.size() - 1);
			}
			m.drawX = x;
			m.drawY = y;
			try {
				g.push();
				g.translate(x, y);
				g.scale(m.scale, m.scale);
				m.render(g, mc, preview);
			} catch (Throwable t) {
				ReminthHud.LOGGER.warn("Reminth panel: {} failed to draw ({})", m.id, t.toString());
			} finally {
				g.pop();
			}
		}
	}

	private static final boolean MINIMAP = net.fabricmc.loader.api.FabricLoader.getInstance().isModLoaded("xaerominimap");

	private static int[] rect(Module m, int x, int y) {
		return new int[] {x, y, x + Math.round(m.lastW * m.scale), y + Math.round(m.lastH * m.scale)};
	}

	/** The nearest free top edge going down (dir 1) or up (dir -1) from y, or -1 when there is none on screen. */
	private static int free(List<int[]> taken, int x, int y, Module m, int sh, int dir) {
		int w = Math.round(m.lastW * m.scale), h = Math.round(m.lastH * m.scale);
		for (int tries = 0; tries < 64; tries++) {
			if (y < 0 || y + h > sh) return -1;
			int[] hit = null;
			for (int[] r : taken) if (x < r[2] && x + w > r[0] && y < r[3] + 2 && y + h + 2 > r[1]) hit = r;
			if (hit == null) return y;
			y = dir > 0 ? hit[3] + 3 : hit[1] - h - 3;
		}
		return -1;
	}

	/* ------------------------------ on/off ------------------------------ */

	public static void setEnabled(Module m, boolean on) {
		if (m.enabled == on) return;
		m.enabled = on;
		Minecraft mc = Minecraft.getInstance();
		try {
			if (on) m.onEnable(mc);
			else m.onDisable(mc);
		} catch (Throwable t) {
			ReminthHud.LOGGER.warn("Reminth panel: {} on/off failed ({})", m.id, t.toString());
		}
		save();
	}

	/* ------------------------------ profiles ------------------------------ */

	public static List<String> profileNames() {
		return new ArrayList<>(profiles.keySet());
	}

	private static JsonObject capture() {
		JsonObject p = new JsonObject();
		for (Module m : MODULES) {
			JsonObject o = new JsonObject();
			o.addProperty("on", m.enabled);
			if (m.restore != null) o.addProperty("restore", m.restore);
			if (m.isHud()) {
				o.addProperty("anchor", m.anchor.name());
				o.addProperty("dx", m.dx);
				o.addProperty("dy", m.dy);
				o.addProperty("scale", m.scale);
			}
			o.add("opts", Opt.saveAll(m.opts));
			p.add(m.id, o);
		}
		return p;
	}

	private static void apply(JsonObject p, boolean callHooks) {
		Minecraft mc = Minecraft.getInstance();
		for (Module m : MODULES) {
			JsonObject o = p != null && p.get(m.id) instanceof JsonObject j ? j : null;
			boolean on = m.defaultOn;
			m.resetPlacement();
			if (o != null) {
				if (o.get("on") != null && o.get("on").isJsonPrimitive()) on = o.get("on").getAsBoolean();
				if (m.isHud()) {
					try {
						if (o.get("anchor") != null) m.anchor = Module.Anchor.valueOf(o.get("anchor").getAsString());
						if (o.get("dx") != null) m.dx = o.get("dx").getAsInt();
						if (o.get("dy") != null) m.dy = o.get("dy").getAsInt();
						if (o.get("scale") != null) m.scale = Math.max(0.5f, Math.min(3f, o.get("scale").getAsFloat()));
					} catch (RuntimeException ignored) {
						m.resetPlacement();
					}
				}
			}
			Opt.loadAll(m.opts, o != null && o.get("opts") instanceof JsonObject oo ? oo : null);
			// a setting changed by the running profile is still put back when switching to one where it is off
			if (o != null && o.get("restore") != null && o.get("restore").isJsonPrimitive()) m.restore = o.get("restore").getAsString();
			else if (!callHooks) m.restore = null;
			if (callHooks && m.enabled != on) {
				m.enabled = on;
				try {
					if (on) m.onEnable(mc);
					else m.onDisable(mc);
				} catch (Throwable ignored) {
					// a hook that fails leaves the game as it was
				}
			} else {
				m.enabled = on;
			}
		}
	}

	public static void switchTo(String name) {
		if (!profiles.containsKey(name)) return;
		profiles.put(active, capture());
		active = name;
		apply(profiles.get(name), true);
		save();
	}

	/** A copy of the current settings under a new name; it becomes the active profile. */
	public static String saveAsNew() {
		profiles.put(active, capture());
		int n = profiles.size() + 1;
		String name = "Profile " + n;
		while (profiles.containsKey(name)) name = "Profile " + (++n);
		profiles.put(name, capture());
		active = name;
		save();
		return name;
	}

	public static boolean rename(String from, String to) {
		to = to == null ? "" : to.trim();
		if (to.isEmpty() || to.length() > 24 || profiles.containsKey(to) || !profiles.containsKey(from)) return false;
		Map<String, JsonObject> copy = new LinkedHashMap<>();
		for (var e : profiles.entrySet()) copy.put(e.getKey().equals(from) ? to : e.getKey(), e.getValue());
		profiles.clear();
		profiles.putAll(copy);
		if (active.equals(from)) active = to;
		save();
		return true;
	}

	public static boolean delete(String name) {
		if (profiles.size() <= 1 || !profiles.containsKey(name)) return false;
		profiles.remove(name);
		if (active.equals(name)) {
			active = profiles.keySet().iterator().next();
			apply(profiles.get(active), true);
		}
		save();
		return true;
	}

	/** Every feature of the active profile back to how it comes. */
	public static void resetProfile() {
		apply(new JsonObject(), true);
		save();
	}

	/* ------------------------------ file ------------------------------ */

	private static Path file() {
		return FabricLoader.getInstance().getConfigDir().resolve("reminthhud-panel.json");
	}

	static void load() {
		profiles.clear();
		try {
			Path f = file();
			if (Files.exists(f)) {
				JsonElement root = JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8));
				if (root instanceof JsonObject o && o.get("profiles") instanceof JsonObject ps) {
					for (var e : ps.entrySet()) if (e.getValue() instanceof JsonObject p) profiles.put(e.getKey(), p);
					if (o.get("active") != null && profiles.containsKey(o.get("active").getAsString())) active = o.get("active").getAsString();
				}
			}
		} catch (Exception e) {
			ReminthHud.LOGGER.info("Reminth panel: couldn't read its settings ({}), using the defaults", e.toString());
			profiles.clear();
		}
		if (profiles.isEmpty()) {
			active = "Default";
			apply(new JsonObject(), false);
			profiles.put(active, capture());
		} else {
			if (!profiles.containsKey(active)) active = profiles.keySet().iterator().next();
			apply(profiles.get(active), false);
		}
	}

	public static void save() {
		try {
			profiles.put(active, capture());
			JsonObject root = new JsonObject();
			root.addProperty("active", active);
			JsonObject ps = new JsonObject();
			for (var e : profiles.entrySet()) ps.add(e.getKey(), e.getValue());
			root.add("profiles", ps);
			Path f = file();
			Files.createDirectories(f.getParent());
			Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
			Files.writeString(tmp, GSON.toJson(root), StandardCharsets.UTF_8);
			Files.move(tmp, f, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
		} catch (Exception e) {
			ReminthHud.LOGGER.warn("Reminth panel: couldn't save its settings ({})", e.toString());
		}
	}
}
