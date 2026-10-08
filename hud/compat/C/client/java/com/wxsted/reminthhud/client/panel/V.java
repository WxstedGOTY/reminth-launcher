package com.wxsted.reminthhud.client.panel;

import com.mojang.blaze3d.platform.InputConstants;
import com.wxsted.reminthhud.ReminthHud;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.Holder;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffect;

/** The few calls that differ between Minecraft versions (compat family C: 26.1). */
public final class V {
	private V() {
	}

	public static Screen screen(Minecraft mc) {
		return mc.screen;
	}

	public static void setScreen(Minecraft mc, Screen s) {
		mc.setScreen(s);
	}

	public static Identifier effectSprite(Holder<MobEffect> effect) {
		return Gui.getMobEffectSprite(effect);
	}

	/** A key in Controls (category: KeyMapping.Category on 26.x). */
	public static KeyMapping registerKey(String name, int key, Object category) {
		return KeyMappingHelper.registerKeyMapping(new KeyMapping(name, keyboard(), key, (KeyMapping.Category) category));
	}

	/** 26.3 merged KEYSYM into KEYBOARD: found by name so one jar works on both. */
	private static InputConstants.Type keyboard() {
		for (String n : new String[] {"KEYBOARD", "KEYSYM"}) {
			try {
				return Enum.valueOf(InputConstants.Type.class, n);
			} catch (IllegalArgumentException ignored) {
				// try the other name
			}
		}
		throw new IllegalStateException("No keyboard input type");
	}

	/** Draws `after` on top of `screen` every frame (for the tips on the title and loading screens). */
	public static void afterDraw(net.minecraft.client.gui.screens.Screen screen, Consumer<Gfx> after) {
		ScreenEvents.afterExtract(screen).register((s, g, mx, my, d) -> after.accept(new Gfx(g)));
	}

	public static boolean matches(KeyMapping k, int key, int scancode, int mods) {
		return k.matches(new KeyEvent(key, scancode, mods));
	}

	/** Draws `hud` with the game's HUD, under the chat. */
	public static void registerHud(Consumer<Gfx> hud) {
		HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, ReminthHud.id("panel_hud"), (g, delta) -> hud.accept(new Gfx(g)));
	}

	/** F3's screen is open. */
	public static boolean debugShown(Minecraft mc) {
		return mc.debugEntries.isOverlayVisible();
	}
}
