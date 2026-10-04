package com.wxsted.reminthhud.client;

import java.lang.reflect.Field;

import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.event.Event;
import net.fabricmc.loader.api.FabricLoader;

import net.minecraft.client.Minecraft;

/**
 * Just Enough Items (JEI) loads every recipe in the game on the render thread
 * (about a second, more with many mods) - a freeze. It starts when the
 * server's "recipes updated" packet arrives. Many servers never send that
 * packet at join, and then JEI waits until the FIRST inventory-type screen
 * opens: the freeze lands the first time the player presses E.
 *
 * This runs the very same action JEI runs when that packet arrives
 * (JeiLifecycleEvents.AFTER_RECIPES_UPDATED, the one JEI's own mixin fires),
 * about 1.5 seconds after joining and only if no recipe update has come by
 * then, so the freeze happens while the world is still loading. JEI is
 * reached by name, so this needs no JEI download and does nothing if JEI isn't
 * installed or its code looks different (one INFO line, never an error).
 */
final class JeiEarlyStart {
	private static final int DELAY_TICKS = 30;

	private static Event<Runnable> recipesUpdatedEvent = null;
	private static boolean recipesUpdated = false;
	private static boolean done = true; // nothing to do until a join
	private static int ticks = 0;
	// Test only (-Dreminthhud.testEarly=true): fire even though JEI already started.
	private static final boolean TEST = Boolean.getBoolean("reminthhud.testEarly");

	private JeiEarlyStart() {
	}

	@SuppressWarnings("unchecked")
	static void init() {
		if (!FabricLoader.getInstance().isModLoaded("jei")) {
			return;
		}
		try {
			Class<?> events = Class.forName("mezz.jei.fabric.events.JeiLifecycleEvents");
			Field field = events.getField("AFTER_RECIPES_UPDATED");
			recipesUpdatedEvent = (Event<Runnable>) field.get(null);
			// Learn when the real packet arrived, so JEI is never started twice.
			recipesUpdatedEvent.register(() -> recipesUpdated = true);
		} catch (Throwable t) {
			ReminthHud.LOGGER.info("ReminthHUD: JEI's start-up hook isn't where it was ({}), leaving JEI alone", t.toString());
			recipesUpdatedEvent = null;
			return;
		}
		ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
			recipesUpdated = false;
			ticks = 0;
			done = false;
		});
		ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> done = true);
		ClientTickEvents.END_CLIENT_TICK.register(JeiEarlyStart::tick);
	}

	private static void tick(Minecraft client) {
		if (done || recipesUpdatedEvent == null) {
			return;
		}
		if (client.level == null || client.player == null) {
			return;
		}
		if (recipesUpdated && !TEST) {
			done = true; // the server sent them: JEI started by itself
			return;
		}
		if (++ticks < DELAY_TICKS) {
			return;
		}
		done = true;
		try {
			recipesUpdatedEvent.invoker().run();
			ReminthHud.LOGGER.info("ReminthHUD: started JEI early (the server sent no recipe update)");
		} catch (Throwable t) {
			ReminthHud.LOGGER.info("ReminthHUD: couldn't start JEI early ({})", t.toString());
		}
	}
}
