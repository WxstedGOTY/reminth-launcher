package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Hud;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.Holder;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffect;

/** The few calls that differ between Minecraft versions (compat family A: 26.2 and 26.3). */
public final class V {
	private V() {
	}

	public static Screen screen(Minecraft mc) {
		return mc.gui.screen();
	}

	public static void setScreen(Minecraft mc, Screen s) {
		mc.gui.setScreen(s);
	}

	public static Identifier effectSprite(Holder<MobEffect> effect) {
		return Hud.getMobEffectSprite(effect);
	}
}
