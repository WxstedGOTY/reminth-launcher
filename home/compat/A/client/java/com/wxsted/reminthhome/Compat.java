package com.wxsted.reminthhome;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/** The few calls that differ between Minecraft versions. This is the version for 26.2. */
final class Compat {
	private Compat() {
	}

	static void setScreen(Minecraft mc, Screen screen) {
		mc.gui.setScreen(screen);
	}

	static Screen options(Screen parent, Minecraft mc) {
		return new OptionsScreen(parent, mc.options, false);
	}

	static Screen language(Screen parent, Minecraft mc) {
		return new LanguageSelectScreen(parent, mc.options, mc.getLanguageManager());
	}

	/**
	 * Puts the pointer back (the pointer fix): the game's own cursor switch is told "nothing selected", so its next
	 * pick (arrow, hand or text beam) is applied again - as Reminth's pixel cursor when that is on. True when done.
	 */
	static boolean resetCursor(Minecraft mc) {
		com.mojang.blaze3d.platform.Window w = mc.getWindow();
		try {
			java.lang.reflect.Field f = com.mojang.blaze3d.platform.Window.class.getDeclaredField("currentCursor");
			f.setAccessible(true);
			f.set(w, com.mojang.blaze3d.platform.cursor.CursorType.DEFAULT);
		} catch (Throwable ignored) {
			// a different shape: the select below still puts a cursor back
		}
		com.mojang.blaze3d.platform.cursor.CursorType.DEFAULT.select(w);
		return true;
	}

	/** Whether this Minecraft runs its window on SDL3 (26.3+) instead of GLFW. */
	static boolean sdl() {
		return false;
	}

	/** Whether the game is in full screen (the pointer fix). */
	static boolean isFullscreen(Minecraft mc) {
		return mc.getWindow().isFullscreen();
	}

	/** The GLFW window id (the pointer fix). */
	static long windowHandle(Minecraft mc) {
		return mc.getWindow().handle();
	}

	/** Realms' own screen (its class name only maps on this version's build). */
	static Screen realms(Screen parent) {
		return new com.mojang.realmsclient.RealmsMainScreen(parent);
	}

	static Screen singleplayer(Screen parent) {
		return new SelectWorldScreen(parent);
	}

	static Screen multiplayer(Screen parent, Minecraft mc) {
		return mc.options.skipMultiplayerWarning ? new JoinMultiplayerScreen(parent) : new SafetyScreen(parent);
	}

	static void connect(Screen parent, Minecraft mc, ServerData sd) {
		ConnectScreen.startConnecting(parent, mc, ServerAddress.parseString(sd.ip), sd, false, null);
	}

	/** A rounded button; iconName is a file under textures/gui/icons, or null for a text button. */
	static AbstractWidget button(int x, int y, int w, int h, Component label, String iconName, int radius, Runnable action) {
		Identifier icon = iconName == null ? null : Identifier.fromNamespaceAndPath(ReminthHomeClient.MOD_ID, "textures/gui/icons/" + iconName + ".png");
		return new RoundButton(x, y, w, h, label, icon, radius, action);
	}

	static AbstractWidget shade(int width, int height) {
		return new Shade(width, height);
	}

	/** One chat line only this player sees (the server-rules heads-up). */
	static void say(Minecraft mc, net.minecraft.network.chat.Component c) {
		mc.player.sendSystemMessage(c);
	}
}
