package com.wxsted.reminthhud.client.panel;

import java.util.List;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;

/**
 * A scrolling list of options (switches, sliders, colour swatches, choices, text boxes and headings), used by a
 * feature's options window, the panel's SETTINGS tab and the Stream Text studio. Drawn in the screen's own (virtual)
 * coordinates; every change calls `changed` (usually Panel::save).
 */
final class OptList {
	static final int ROW = 22;
	private static final int SW = 11; // swatch step

	List<Opt> opts;
	private final Runnable changed;
	int x, y, w, h;
	private double scroll;
	private Opt.Num dragging;
	private Opt.Text editing;
	private int dragX0;

	OptList(List<Opt> opts, Runnable changed) {
		this.opts = opts;
		this.changed = changed;
	}

	void layout(int x, int y, int w, int h) {
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		clamp();
	}

	void setOpts(List<Opt> o) {
		if (o != opts) {
			opts = o;
			scroll = 0;
			editing = null;
			dragging = null;
		}
	}

	int contentH() {
		return opts.size() * ROW;
	}

	boolean editingText() {
		return editing != null;
	}

	private void clamp() {
		scroll = Math.max(0, Math.min(scroll, Math.max(0, contentH() - h)));
	}

	private int rowY(int i) {
		return y + i * ROW - (int) scroll;
	}

	private int sliderX() {
		return x + w - 156;
	}

	private int swatchX() {
		return x + w - 6 - Opt.Color.SWATCHES.length * SW;
	}

	private int textX() {
		return x + Math.max(110, w * 2 / 5);
	}

	private int labelMax(Opt o) {
		int end = o instanceof Opt.Bool ? x + w - 44 : o instanceof Opt.Num ? sliderX() : o instanceof Opt.Color ? swatchX() : o instanceof Opt.Choice ? x + w - 140 : o instanceof Opt.Text ? textX() : x + w;
		return end - x - 14;
	}

	void draw(Gfx g, int mx, int my) {
		clamp();
		var font = Draw.font();
		g.enableScissor(x, y, x + w, y + h);
		for (int i = 0; i < opts.size(); i++) {
			Opt o = opts.get(i);
			int ry = rowY(i);
			if (ry + ROW < y || ry > y + h) continue;
			if (o instanceof Opt.Label) {
				Draw.text(g, Component.literal(o.label.toUpperCase(java.util.Locale.ROOT)).withStyle(ChatFormatting.BOLD), x + 6, ry + 9, 0.75f, Draw.TEXT_FAINT, false);
				g.fill(x + 6, ry + ROW - 3, x + w - 6, ry + ROW - 2, 0x22FFFFFF);
				continue;
			}
			boolean in = Draw.in(mx, my, x, y, w, h);
			if (in && Draw.in(mx, my, x + 2, ry, w - 4, ROW - 2)) Draw.round(g, x + 2, ry, w - 4, ROW - 2, 4, 0x1AFFFFFF);
			g.text(font, Draw.fit(o.label, labelMax(o), 1f), x + 8, ry + 6, Draw.TEXT, true);
			if (o instanceof Opt.Bool b) {
				int sx = x + w - 38;
				Draw.round(g, sx, ry + 3, 28, 14, 7, b.value ? Draw.ON : 0xFF55555A);
				Draw.round(g, b.value ? sx + 15 : sx + 1, ry + 4, 12, 12, 6, 0xFFFFFFFF);
			} else if (o instanceof Opt.Num n) {
				int cx = sliderX(), tw = 100;
				float f = (float) ((n.value - n.min) / (n.max - n.min));
				Draw.round(g, cx, ry + 8, tw, 4, 2, 0xFF55555A);
				Draw.round(g, cx, ry + 8, Math.round(tw * f), 4, 2, Draw.ACCENT);
				Draw.round(g, cx + Math.round(tw * f) - 4, ry + 4, 9, 12, 3, 0xFFFFFFFF);
				g.text(font, n.shown(), cx + tw + 8, ry + 6, Draw.TEXT_DIM, true);
			} else if (o instanceof Opt.Color c) {
				int cx = swatchX();
				for (int k = 0; k < Opt.Color.SWATCHES.length; k++) {
					int sx = cx + k * SW, col = Opt.Color.SWATCHES[k];
					if (col == c.value) {
						Draw.round(g, sx - 1, ry + 3, 11, 14, 3, 0xFFFFFFFF);
						Draw.round(g, sx, ry + 4, 9, 12, 2, 0xFF141416);
					}
					Draw.round(g, sx + 1, ry + 5, 7, 10, 2, col);
				}
			} else if (o instanceof Opt.Choice ch) {
				int cx = x + w - 136;
				boolean hot = Draw.in(mx, my, cx, ry + 2, 130, 16);
				Draw.tile(g, cx, ry + 2, 130, 16, 3, hot ? Draw.TILE_EDGE_HOT : 0xFF2A2A2D, hot ? Draw.BUTTON_HOT : Draw.BUTTON);
				Draw.centered(g, "< " + Draw.fit(ch.shown(), 104, 1f) + " >", cx + 65, ry + 6, 1f, Draw.TEXT);
			} else if (o instanceof Opt.Text t) {
				int bx = textX(), bw = x + w - 8 - bx;
				boolean focus = editing == t;
				Draw.tile(g, bx, ry + 2, bw, 16, 3, focus ? Draw.TILE_EDGE_HOT : 0xFF4A4A4E, 0xE0232326);
				String shown = t.value;
				while (font.width(shown) > bw - 12 && shown.length() > 1) shown = shown.substring(1);
				if (shown.isEmpty() && !focus) g.text(font, "Click to type...", bx + 5, ry + 6, Draw.TEXT_FAINT, false);
				else g.text(font, shown, bx + 5, ry + 6, Draw.TEXT, false);
				if (focus && (System.currentTimeMillis() / 500) % 2 == 0) g.fill(bx + 6 + font.width(shown), ry + 5, bx + 7 + font.width(shown), ry + 15, 0xFFFFFFFF);
			}
		}
		g.disableScissor();
		int ch = contentH();
		if (ch > h) {
			int barH = Math.max(16, h * h / ch);
			int barY = y + (int) ((h - barH) * (scroll / (ch - h)));
			Draw.round(g, x + w - 2, barY, 2, barH, 1, 0x66FFFFFF);
		}
	}

	boolean click(double mx, double my, int button) {
		if (!Draw.in(mx, my, x, y, w, h)) {
			if (editing != null) {
				editing = null;
				changed.run();
			}
			return false;
		}
		Opt.Text wasEditing = editing;
		editing = null;
		for (int i = 0; i < opts.size(); i++) {
			Opt o = opts.get(i);
			int ry = rowY(i);
			if (!Draw.in(mx, my, x, ry, w, ROW)) continue;
			if (o instanceof Opt.Bool b && button == 0) {
				b.value = !b.value;
				changed.run();
				return true;
			}
			if (o instanceof Opt.Num n && Draw.in(mx, my, sliderX() - 5, ry, 110, 20)) {
				dragging = n;
				dragX0 = sliderX();
				n.set(n.min + (n.max - n.min) * Math.max(0, Math.min(1, (mx - dragX0) / 100.0)));
				return true;
			}
			if (o instanceof Opt.Color c) {
				for (int k = 0; k < Opt.Color.SWATCHES.length; k++) {
					if (Draw.in(mx, my, swatchX() + k * SW, ry + 3, SW, 14)) {
						c.value = Opt.Color.SWATCHES[k];
						changed.run();
						return true;
					}
				}
			}
			if (o instanceof Opt.Choice ch && Draw.in(mx, my, x + w - 136, ry + 2, 130, 16)) {
				int n = ch.choices.length;
				ch.value = button == 1 || mx < x + w - 136 + 30 ? (ch.value + n - 1) % n : (ch.value + 1) % n;
				changed.run();
				return true;
			}
			if (o instanceof Opt.Text t && Draw.in(mx, my, textX(), ry + 2, x + w - 8 - textX(), 16)) {
				editing = t;
				return true;
			}
			if (wasEditing != null) changed.run();
			return true;
		}
		if (wasEditing != null) changed.run();
		return true;
	}

	boolean drag(double mx, double my) {
		if (dragging == null) return false;
		dragging.set(dragging.min + (dragging.max - dragging.min) * Math.max(0, Math.min(1, (mx - dragX0) / 100.0)));
		return true;
	}

	boolean release() {
		if (dragging == null) return false;
		dragging = null;
		changed.run();
		return true;
	}

	boolean scroll(double mx, double my, double sy) {
		if (!Draw.in(mx, my, x, y, w, h) || contentH() <= h) return false;
		scroll -= sy * 22;
		clamp();
		return true;
	}

	boolean typed(String s) {
		if (editing == null) return false;
		if (editing.value.length() + s.length() <= editing.max) editing.value += s;
		return true;
	}

	/** Keys while typing in a box: Backspace, Enter/Esc to stop. Every other key is eaten so it can't do anything else. */
	boolean key(int key) {
		if (editing == null) return false;
		if (key == InputConstants.KEY_BACKSPACE) {
			if (!editing.value.isEmpty()) editing.value = editing.value.substring(0, editing.value.length() - 1);
		} else if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER || key == InputConstants.KEY_ESCAPE || key == InputConstants.KEY_TAB) {
			editing = null;
			changed.run();
		}
		return true;
	}

	/** Starts typing in this box (the Stream Text studio does it when a line is picked). */
	void edit(Opt.Text t) {
		editing = t;
	}

	void stopEditing() {
		if (editing != null) {
			editing = null;
			changed.run();
		}
	}
}
