package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.Component;

/** Small drawing helpers for the panel: rounded tiles, icons, scaled text. Colours are ARGB. */
public final class Draw {
	private Draw() {
	}

	// The panel's colours: Minecraft's button greys, white text, green/red for on/off.
	public static final int WINDOW = 0xEE141416;
	public static final int WINDOW_EDGE = 0x55FFFFFF;
	public static final int BAR = 0xF01B1B1E;
	public static final int TILE = 0xFF3A3A3D;
	public static final int TILE_HOT = 0xFF4A4A4E;
	public static final int TILE_EDGE = 0xFF5C5C61;
	public static final int TILE_EDGE_HOT = 0xFFB9B9BE;
	public static final int BUTTON = 0xFF6F6F73; // Minecraft's button grey
	public static final int BUTTON_HOT = 0xFF8A8A8F;
	public static final int TEXT = 0xFFFFFFFF;
	public static final int TEXT_DIM = 0xFFB4B4B8;
	public static final int TEXT_FAINT = 0xFF7E7E84;
	public static final int ON = 0xFF3FA34D;
	public static final int ON_HOT = 0xFF4CBB5B;
	public static final int OFF = 0xFFB8403C;
	public static final int OFF_HOT = 0xFFD04B46;
	public static final int ACCENT = 0xFFFFFFFF;
	public static final int NEW_TAG = 0xFFE5484D;

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
