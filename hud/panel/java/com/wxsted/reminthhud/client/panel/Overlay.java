package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;

/** A feature that draws over the whole screen (bars, grid, border, filters, the crosshair...), not at one place. */
public interface Overlay {
	void overlay(Gfx g, Minecraft mc);

	/** Drawn after (over) the HUD displays instead of before them. */
	default boolean onTop() {
		return false;
	}
}
