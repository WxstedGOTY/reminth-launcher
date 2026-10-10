package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.Component;

/** Small drawing helpers for the panel: rounded tiles, icons, scaled text. Colours are ARGB. */
public final class Draw {
	private Draw() {
	}

	// The panel's colours: Minecraft's button greys, white text, green/red for on/off.
	public static int WINDOW = 0xEE141416;
	public static int WINDOW_EDGE = 0x55FFFFFF;
	public static int BAR = 0xF01B1B1E;
	public static int TILE = 0xFF3A3A3D;
	public static int TILE_HOT = 0xFF4A4A4E;
	public static int TILE_EDGE = 0xFF5C5C61;
	public static int TILE_EDGE_HOT = 0xFFB9B9BE;
	public static int BUTTON = 0xFF6F6F73; // Minecraft's button grey
	public static int BUTTON_HOT = 0xFF8A8A8F;
	public static final int TEXT = 0xFFFFFFFF;
	public static final int TEXT_DIM = 0xFFB4B4B8;
	public static final int TEXT_FAINT = 0xFF7E7E84;
	public static final int ON = 0xFF3FA34D;
	public static final int ON_HOT = 0xFF4CBB5B;
	public static final int OFF = 0xFFB8403C;
	public static final int OFF_HOT = 0xFFD04B46;
	public static int ACCENT = 0xFFFFFFFF;
	public static final int NEW_TAG = 0xFFE5484D;

	/**
	 * The panel's look from its Look settings (PanelLook): how see-through the window and cards are, and the accent
	 * colour. Called every frame by the panel's screens (cheap: a few ints).
	 */
	public static void applyStyle(float opacity, int accent) {
		int a = Math.round(Math.max(0.1f, Math.min(1f, opacity)) * 255);
		int t = Math.min(255, a + 40);
		WINDOW = (a << 24) | 0x141416;
		BAR = (Math.min(255, a + 25) << 24) | 0x1B1B1E;
		WINDOW_EDGE = (Math.min(255, a / 3 + 30) << 24) | 0xFFFFFF;
		TILE = (t << 24) | 0x3A3A3D;
		TILE_HOT = (t << 24) | 0x4A4A4E;
		TILE_EDGE = (t << 24) | 0x5C5C61;
		TILE_EDGE_HOT = (accent & 0xFFFFFF) == 0xFFFFFF ? 0xFFB9B9BE : 0xFF000000 | accent;
		BUTTON = (Math.min(255, t + 20) << 24) | 0x6F6F73;
		BUTTON_HOT = (Math.min(255, t + 20) << 24) | 0x8A8A8F;
		ACCENT = 0xFF000000 | accent;
	}

	/** A colour going round the rainbow (speed: rounds per second; offset 0..1 shifts it). */
	public static int rainbow(float speed, float offset) {
		float h = (System.currentTimeMillis() % 1000000L) / 1000f * speed + offset;
		return hsb(h - (float) Math.floor(h), 0.7f, 1f);
	}

	/** HSB (0..1 each) to opaque ARGB. */
	public static int hsb(float h, float s, float b) {
		return 0xFF000000 | (java.awt.Color.HSBtoRGB(h, s, b) & 0xFFFFFF);
	}

	/** A colour with its alpha replaced (0..1). */
	public static int alpha(int color, double a) {
		return ((int) Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (color & 0xFFFFFF);
	}

	/** How far a row is pulled in from the edge to round a corner of radius r. */
	static int inset(int r, int row) {
		if (row >= r) return 0;
		double dy = r - row - 0.5;
		return r - (int) Math.round(Math.sqrt(r * (double) r - dy * dy));
	}

	/** A filled rounded rectangle. */
	public static void round(Gfx g, int x, int y, int w, int h, int r, int fill) {
		if (w <= 0 || h <= 0) return;
		r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
		for (int i = 0; i < r; i++) {
			int o = inset(r, i);
			g.fill(x + o, y + i, x + w - o, y + i + 1, fill);
			g.fill(x + o, y + h - 1 - i, x + w - o, y + h - i, fill);
		}
		g.fill(x, y + r, x + w, y + h - r, fill);
	}

	/** A rounded rectangle with a 1 px border; border and fill never overlap. */
	public static void tile(Gfx g, int x, int y, int w, int h, int r, int border, int fill) {
		if (w <= 2 || h <= 2) return;
		round(g, x, y, w, h, r, border);
		round(g, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1), fill);
	}

	/** One of our 128x128 icons drawn at size s. */
	public static void icon(Gfx g, String name, int x, int y, int s) {
		g.icon(name, x, y, s, 0xFFFFFFFF);
	}

	/** Same, tinted (ARGB; the icons are white). */
	public static void icon(Gfx g, String name, int x, int y, int s, int color) {
		g.icon(name, x, y, s, color);
	}

	public static Font font() {
		return Minecraft.getInstance().font;
	}

	/** Text at a scale (1 = normal), left-aligned. */
	public static void text(Gfx g, String s, float x, float y, float scale, int color, boolean shadow) {
		g.push();
		g.translate(x, y);
		g.scale(scale, scale);
		g.text(font(), s, 0, 0, color, shadow);
		g.pop();
	}

	public static void text(Gfx g, Component s, float x, float y, float scale, int color, boolean shadow) {
		g.push();
		g.translate(x, y);
		g.scale(scale, scale);
		g.text(font(), s, 0, 0, color, shadow);
		g.pop();
	}

	/** Centered text at a scale. */
	public static void centered(Gfx g, String s, float cx, float y, float scale, int color) {
		float w = font().width(s) * scale;
		text(g, s, cx - w / 2f, y, scale, color, false);
	}

	public static void centered(Gfx g, Component s, float cx, float y, float scale, int color) {
		float w = font().width(s) * scale;
		text(g, s, cx - w / 2f, y, scale, color, false);
	}

	/** Trims a string to fit a width at a scale, with "..." at the end. */
	public static String fit(String s, int maxWidth, float scale) {
		Font f = font();
		if (f.width(s) * scale <= maxWidth) return s;
		String out = s;
		while (out.length() > 1 && (f.width(out + "...") * scale) > maxWidth) out = out.substring(0, out.length() - 1);
		return out + "...";
	}

	public static boolean in(double mx, double my, int x, int y, int w, int h) {
		return mx >= x && my >= y && mx < x + w && my < y + h;
	}

	/** Mixes two ARGB colours (t = 0 -> a, 1 -> b). */
	public static int mix(int a, int b, float t) {
		int r = 0;
		for (int s = 0; s < 32; s += 8) {
			int ca = (a >>> s) & 0xFF, cb = (b >>> s) & 0xFF;
			r |= Math.round(ca + (cb - ca) * t) << s;
		}
		return r;
	}
}
