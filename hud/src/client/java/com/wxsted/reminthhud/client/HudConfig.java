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
 * {"fps":true,"gpu":true,"cpu":true,"lat":true,"coords":true}. Read once at
 * start-up. A missing file is written with everything on; a file that can't
 * be read is left alone (it's the player's) and everything is shown.
 */
final class HudConfig {
	boolean fps = true;
	boolean gpu = true;
	boolean cpu = true;
	boolean lat = true;
	boolean coords = true;

	static HudConfig load() {
		HudConfig c = new HudConfig();
		Path file = FabricLoader.getInstance().getConfigDir().resolve("reminthhud.json");
		try {
			if (!Files.exists(file)) {
				Files.createDirectories(file.getParent());
				Files.writeString(file, "{\n  \"fps\": true,\n  \"gpu\": true,\n  \"cpu\": true,\n  \"lat\": true,\n  \"coords\": true\n}\n", StandardCharsets.UTF_8);
				return c;
			}
			JsonElement root = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8));
			if (!root.isJsonObject()) return c;
			JsonObject o = root.getAsJsonObject();
			c.fps = flag(o, "fps");
			c.gpu = flag(o, "gpu");
			c.cpu = flag(o, "cpu");
			c.lat = flag(o, "lat");
			c.coords = flag(o, "coords");
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
