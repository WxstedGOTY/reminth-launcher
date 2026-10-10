package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;

import net.minecraft.client.Minecraft;

/**
 * One feature of the panel ("module"): a card in the grid with an on/off button and its own options. HUD features
 * also draw on screen and can be moved and resized in the HUD layout editor.
 */
public abstract class Module {
	public enum Cat {
		HUD("HUD", "cat_hud"), STREAM("Streamer", "cat_stream"), VISUAL("Visual", "cat_visual"), PERFORMANCE("Performance", "fpslimit"), MECHANIC("Mechanic", "cat_mechanic"), CHAT("Chat", "cat_chat"), UTILITY("Utility", "cat_utility");

		public final String label;
		public final String icon;

		Cat(String label, String icon) {
			this.label = label;
			this.icon = icon;
		}
	}

	/** Where a HUD feature sits: an anchor point of the screen and an offset from it, in GUI pixels. */
	public enum Anchor {
		TOP_LEFT(0, 0), TOP(0.5f, 0), TOP_RIGHT(1, 0), LEFT(0, 0.5f), CENTER(0.5f, 0.5f), RIGHT(1, 0.5f), BOTTOM_LEFT(0, 1), BOTTOM(0.5f, 1), BOTTOM_RIGHT(1, 1);

		public final float fx, fy;

		Anchor(float fx, float fy) {
			this.fx = fx;
			this.fy = fy;
		}
	}

	public final String id;
	public final String name;
	public final Cat cat;
	public final String description;
	public final String icon;
	public final boolean isNew;
	public final boolean defaultOn;
	public final List<Opt> opts = new ArrayList<>();

	public boolean enabled;
	/** Not a card in the grid (the panel's own settings). */
	public boolean hidden;
	/** What a game setting was before this feature changed it (saved, so switching off after a restart still puts it back). */
	public String restore;
	// HUD placement (only for HUD features)
	public final Anchor defAnchor;
	public final int defDx, defDy;
	public Anchor anchor;
	public int dx, dy;
	public float scale = 1f;
	// size drawn last frame (unscaled), for the layout editor and clamping
	public int lastW = 40, lastH = 10;
	// where it was drawn last frame (a feature still at its default place moves aside for others: Panel.drawHud)
	public int drawX, drawY;

	/** Still where it starts (never moved in the layout editor). */
	public boolean atDefault() {
		return anchor == defAnchor && dx == defDx && dy == defDy;
	}

	protected Module(String id, String name, Cat cat, String icon, String description, boolean isNew, boolean defaultOn, Anchor anchor, int dx, int dy) {
		this.id = id;
		this.name = name;
		this.cat = cat;
		this.icon = icon;
		this.description = description;
		this.isNew = isNew;
		this.defaultOn = defaultOn;
		this.defAnchor = anchor;
		this.defDx = dx;
		this.defDy = dy;
		resetPlacement();
		this.enabled = defaultOn;
	}

	protected <T extends Opt> T opt(T o) {
		opts.add(o);
		return o;
	}

	public boolean isHud() {
		return defAnchor != null;
	}

	public void resetPlacement() {
		anchor = defAnchor;
		dx = defDx;
		dy = defDy;
		scale = 1f;
	}

	/** The top-left corner on a screen of this size (kept on screen). */
	public int screenX(int sw) {
		if (anchor == null) return 0;
		int x = Math.round(sw * anchor.fx) + dx;
		return Math.max(0, Math.min(sw - Math.round(lastW * scale), x));
	}

	public int screenY(int sh) {
		if (anchor == null) return 0;
		int y = Math.round(sh * anchor.fy) + dy;
		return Math.max(0, Math.min(sh - Math.round(lastH * scale), y));
	}

	/** Puts the feature at this top-left corner, measured from the nearest anchor (so it stays put when the window changes). */
	public void placeAt(int x, int y, int sw, int sh) {
		float cx = (x + lastW * scale / 2f) / Math.max(1, sw);
		float cy = (y + lastH * scale / 2f) / Math.max(1, sh);
		float ax = cx < 1 / 3f ? 0 : cx > 2 / 3f ? 1 : 0.5f;
		float ay = cy < 1 / 3f ? 0 : cy > 2 / 3f ? 1 : 0.5f;
		Anchor best = Anchor.CENTER;
		for (Anchor a : Anchor.values()) if (a.fx == ax && a.fy == ay) best = a;
		anchor = best;
		dx = x - Math.round(sw * best.fx);
		dy = y - Math.round(sh * best.fy);
	}

	/** Turned on (also after loading a profile where it is on). */
	public void onEnable(Minecraft mc) {
	}

	/** Turned off (also when the game closes or another profile has it off). */
	public void onDisable(Minecraft mc) {
	}

	public void tick(Minecraft mc) {
	}

	/** Its own settings window instead of the usual options list (null = the usual one). */
	public net.minecraft.client.gui.screens.Screen optionsScreen(net.minecraft.client.gui.screens.Screen back) {
		return null;
	}

	/**
	 * Draws the HUD element with its top-left at 0,0 (the caller has moved and scaled), and sets lastW/lastH. `preview`:
	 * drawn in the layout editor - show sample values when there is nothing to show yet.
	 */
	public void render(Gfx g, Minecraft mc, boolean preview) {
	}
}
