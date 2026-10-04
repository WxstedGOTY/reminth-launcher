package com.wxsted.reminthhome;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ReminthHomeClient implements ClientModInitializer {
	public static final String MOD_ID = "reminthhome";
	static final Logger LOG = LoggerFactory.getLogger("ReminthHome");
	/** Set after the first failure: from then on the vanilla title screen is used. */
	private static volatile boolean failed = false;
	private static volatile boolean enabled = true;

	@Override
	public void onInitializeClient() {
		enabled = readEnabled();
	}

	/** config/reminthhome.json {"enabled": false} turns the screen off; anything unreadable leaves it on. */
	static boolean readEnabled() {
		try {
			Path p = FabricLoader.getInstance().getConfigDir().resolve("reminthhome.json");
			if (!Files.exists(p)) {
				Files.writeString(p, "{\n  \"enabled\": true\n}\n");
				return true;
			}
			return !Files.readString(p).replaceAll("\s", "").contains("\"enabled\":false");
		} catch (Throwable t) {
			return true;
		}
	}

	/** The camera angle for the title panorama: a little upwards while our screen is in use. */
	public static float panoramaPitch(float vanilla) {
		return enabled && !failed ? -6.0f : vanilla;
	}

	/** Called for every Gui.setScreen: only the exact vanilla TitleScreen is replaced. */
	public static Screen swap(Screen screen) {
		if (!enabled || failed || screen == null || screen.getClass() != TitleScreen.class) return screen;
		try {
			boolean fading = false;
			try {
				Field f = TitleScreen.class.getDeclaredField("fading");
				f.setAccessible(true);
				fading = f.getBoolean(screen);
			} catch (Throwable ignored) {
				// the first-start fade-in is cosmetic
			}
			return new ReminthTitleScreen(fading);
		} catch (Throwable t) {
			failed = true;
			LOG.warn("Reminth home screen could not start; using the normal title screen ({})", t.toString());
			return screen;
		}
	}

	static void fail(Throwable t) {
		failed = true;
		LOG.warn("Reminth home screen failed; using the normal title screen from now on ({})", t.toString());
	}
}
