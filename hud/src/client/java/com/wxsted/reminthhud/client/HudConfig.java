package com.wxsted.reminthhud.client;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.loader.api.FabricLoader;

/**
 * Which parts of the HUD are shown: config/reminthhud.json in the instance,
 * {"fps":true,"gpu":true,"cpu":true,"lat":true,"jeiEarlyStart":true}. Read once at
 * start-up. A missing file is written with everything on; a file that can't
 * be read is left alone (it's the player's) and everything is shown.
 */
final class HudConfig {
	// The top-right bar as a whole. Reminth writes it from the instance's HUD switch at every launch (ReminthHUD is in
	// every Fabric/Quilt instance since the panel lives in it); a missing value keeps the bar on, as before.
	boolean bar = true;
	boolean fps = true;
	boolean gpu = true;
	boolean cpu = true;
	boolean lat = true;
	// Start JEI (if installed) right after joining instead of at the first inventory open.
	boolean jeiEarlyStart = true;
	// Ask the server for your own statistics while you play on it (saved on this PC only).
	boolean serverStats = true;

	static HudConfig load() {
		HudConfig c = new HudConfig();
		Path file = FabricLoader.getInstance().getConfigDir().resolve("reminthhud.json");
		try {
			if (!Files.exists(file)) {
				Files.createDirectories(file.getParent());
				String defaults = String.join(System.lineSeparator(),
						"{",
						"  \"fps\": true,",
						"  \"gpu\": true,",
						"  \"cpu\": true,",
						"  \"lat\": true,",
						"  \"jeiEarlyStart\": true,",
						"  \"serverStats\": true",
						"}") + System.lineSeparator();
				Files.writeString(file, defaults, StandardCharsets.UTF_8);
				return c;
			}
			JsonElement root = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8));
			if (!root.isJsonObject()) return c;
			JsonObject o = root.getAsJsonObject();
			c.bar = flag(o, "bar");
			c.fps = flag(o, "fps");
			c.gpu = flag(o, "gpu");
			c.cpu = flag(o, "cpu");
			c.lat = flag(o, "lat");
			c.jeiEarlyStart = flag(o, "jeiEarlyStart");
			c.serverStats = flag(o, "serverStats");
		} catch (Exception e) {
			ReminthHud.LOGGER.info("ReminthHUD: couldn't read {} ({}), showing everything", file, e.toString());
		}
		return c;
	}

	/** Anything but a plain false keeps the item on. */
	private static boolean flag(JsonObject o, String key) {
		JsonElement e = o.get(key);
		if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isBoolean()) return true;
		return e.getAsBoolean();
	}
}
