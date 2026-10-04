package com.wxsted.reminthhome;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.options.OptionsScreen;

/** The few calls that differ between Minecraft versions. This is the version for 26.1. */
final class Compat {
	private Compat() {
	}

	static void setScreen(Minecraft mc, Screen screen) {
		mc.setScreen(screen);
	}

	static Screen options(Screen parent, Minecraft mc) {
		return new OptionsScreen(parent, mc.options, false);
	}
}
