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
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
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

	public static KeyMapping zoomKey() {
		return zoomKey;
	}

	public static KeyMapping openKey() {
		return openKey;
	}

	private static InputConstants.Type keyboard() {
		for (String name : new String[] {"KEYBOARD", "KEYSYM"}) {
			try {
				return Enum.valueOf(InputConstants.Type.class, name);
			} catch (IllegalArgumentException ignored) {
				// try the other name
			}
		}
		throw new IllegalStateException("No keyboard input type");
	}

	public static void init(KeyMapping.Category category) {
		openKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.reminthhud.panel", keyboard(), InputConstants.KEY_G, category));
		zoomKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.reminthhud.zoom", keyboard(), InputConstants.KEY_C, category));
		load();
		ClientTickEvents.END_CLIENT_TICK.register(Panel::tick);
		HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, ReminthHud.id("panel_hud"), Panel::renderHud);
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
			while (openKey.consumeClick()) {
				if (mc.gui.screen() == null) open(null);
			}
			for (Module m : MODULES) if (m.enabled) m.tick(mc);
		} catch (Throwable t) {
			ReminthHud.LOGGER.warn("Reminth panel: tick failed ({})", t.toString());
		}
	}

	/** Opens the panel; `parent` is where closing it goes back to (null: back to the game). */
	public static void open(Screen parent) {
		Minecraft mc = Minecraft.getInstance();
		mc.gui.setScreen(new PanelScreen(parent));
	}

	/** For the home screen's Discover button (found by name: the home mod doesn't depend on this one). */
	public static void openFrom(Screen parent) {
		open(parent);
	}

	private static void renderHud(GuiGraphicsExtractor g, DeltaTracker delta) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null) return;
		if (mc.debugEntries.isOverlayVisible()) return;
		if (mc.gui.screen() instanceof HudEditorScreen) return; // it draws them itself
		drawHud(g, mc, false);
	}

	/** Every switched-on HUD feature at its place. */
	static void drawHud(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
		int sw = g.guiWidth(), sh = g.guiHeight();
		for (Module m : MODULES) {
			if (!m.enabled || !m.isHud()) continue;
			try {
				g.pose().pushMatrix();
				g.pose().translate(m.screenX(sw), m.screenY(sh));
				g.pose().scale(m.scale, m.scale);
				m.render(g, mc, preview);
			} catch (Throwable t) {
				ReminthHud.LOGGER.warn("Reminth panel: {} failed to draw ({})", m.id, t.toString());
			} finally {
				g.pose().popMatrix();
			}
		}
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
