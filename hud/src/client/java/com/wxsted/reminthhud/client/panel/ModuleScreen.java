package com.wxsted.reminthhud.client.panel;

import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** One feature's own settings: switches, sliders, colour swatches and choices, saved to the active profile. */
public class ModuleScreen extends Screen {
	private final Screen back;
	private final Module m;
	private int x0, y0, w, h;
	private Opt.Num dragging;
	private static final int ROW = 24;
	private float sc = 1f; // drawn on a virtual screen of at least 460x300, scaled to fit (like the panel)

	public ModuleScreen(Screen back, Module m) {
		super(Component.literal(m.name));
		this.back = back;
		this.m = m;
	}

	@Override
	protected void init() {
		int need = 70 + Math.max(1, m.opts.size()) * ROW + 36;
		sc = Math.min(1f, Math.min(width / 460f, height / (float) (need + 20)));
		int vw = Math.round(width / sc), vh = Math.round(height / sc);
		w = Math.min(vw - 24, 440);
		h = Math.min(vh - 20, need);
		x0 = (vw - w) / 2;
		y0 = (vh - h) / 2;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		Panel.save();
		minecraft.gui.setScreen(back);
	}

	private int rowY(int i) {
		return y0 + 62 + i * ROW;
	}

	private int ctrlX() {
		return x0 + w - 150;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int rmx, int rmy, float pt) {
		g.pose().pushMatrix();
		g.pose().scale(sc, sc);
		try {
			drawAll(g, Math.round(rmx / sc), Math.round(rmy / sc));
		} finally {
			g.pose().popMatrix();
		}
	}

	private void drawAll(GuiGraphicsExtractor g, int mx, int my) {
		Draw.tile(g, x0 - 1, y0 - 1, w + 2, h + 2, 9, Draw.WINDOW_EDGE, Draw.WINDOW);
		// header
		boolean backHot = Draw.in(mx, my, x0 + 8, y0 + 8, 46, 16);
		Draw.round(g, x0 + 8, y0 + 8, 46, 16, 4, backHot ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.centered(g, "< BACK", x0 + 31, y0 + 13, 0.75f, Draw.TEXT);
		Draw.icon(g, m.icon, x0 + 62, y0 + 8, 28);
		Draw.text(g, Component.literal(m.name).withStyle(ChatFormatting.BOLD), x0 + 96, y0 + 10, 1f, Draw.TEXT, false);
		Draw.text(g, Draw.fit(m.description, w - 200, 0.75f), x0 + 96, y0 + 23, 0.75f, Draw.TEXT_DIM, false);
		int tx = x0 + w - 86, ty = y0 + 12;
		boolean th = Draw.in(mx, my, tx, ty, 76, 16);
		Draw.round(g, tx, ty, 76, 16, 3, m.enabled ? (th ? Draw.ON_HOT : Draw.ON) : (th ? Draw.OFF_HOT : Draw.OFF));
		Draw.centered(g, Component.literal(m.enabled ? "ENABLED" : "DISABLED").withStyle(ChatFormatting.BOLD), tx + 38, ty + 5, 0.75f, 0xFFFFFFFF);
		g.fill(x0 + 8, y0 + 46, x0 + w - 8, y0 + 47, 0x22FFFFFF);
		if (m.opts.isEmpty()) Draw.text(g, "No options: switch it on or off above.", x0 + 14, rowY(0) + 6, 1f, Draw.TEXT_DIM, false);
		for (int i = 0; i < m.opts.size(); i++) {
			Opt o = m.opts.get(i);
			int y = rowY(i);
			if (Draw.in(mx, my, x0 + 6, y - 2, w - 12, ROW - 2)) Draw.round(g, x0 + 6, y - 2, w - 12, ROW - 2, 4, 0xFF222226);
			g.text(font, o.label, x0 + 14, y + 6, Draw.TEXT, false);
			int cx = ctrlX();
			if (o instanceof Opt.Bool b) {
				int sx = x0 + w - 42;
				Draw.round(g, sx, y + 3, 28, 14, 7, b.value ? Draw.ON : 0xFF55555A);
				Draw.round(g, b.value ? sx + 15 : sx + 1, y + 4, 12, 12, 6, 0xFFFFFFFF);
			} else if (o instanceof Opt.Num n) {
				int tw = 100;
				float f = (float) ((n.value - n.min) / (n.max - n.min));
				Draw.round(g, cx, y + 8, tw, 4, 2, 0xFF55555A);
				Draw.round(g, cx, y + 8, Math.round(tw * f), 4, 2, 0xFFFFFFFF);
				Draw.round(g, cx + Math.round(tw * f) - 4, y + 4, 9, 12, 3, 0xFFFFFFFF);
				g.text(font, n.shown(), cx + tw + 8, y + 6, Draw.TEXT_DIM, false);
			} else if (o instanceof Opt.Color c) {
				for (int k = 0; k < Opt.Color.SWATCHES.length; k++) {
					int sx = cx + k * 15, col = Opt.Color.SWATCHES[k];
					if (col == c.value) {
						// a white ring with a dark gap, visible around every colour (white included)
						Draw.round(g, sx - 2, y + 2, 16, 16, 4, 0xFFFFFFFF);
						Draw.round(g, sx - 1, y + 3, 14, 14, 3, 0xFF141416);
					}
					Draw.round(g, sx + 1, y + 5, 10, 10, 2, col);
				}
			} else if (o instanceof Opt.Choice ch) {
				boolean hot = Draw.in(mx, my, cx, y + 2, 130, 16);
				Draw.tile(g, cx, y + 2, 130, 16, 3, hot ? Draw.TILE_EDGE_HOT : 0xFF2A2A2D, hot ? Draw.BUTTON_HOT : Draw.BUTTON);
				Draw.centered(g, "< " + ch.shown() + " >", cx + 65, y + 6, 1f, Draw.TEXT);
			}
		}
		// bottom buttons
		int by = y0 + h - 26;
		boolean rh = Draw.in(mx, my, x0 + 10, by, 90, 18);
		Draw.round(g, x0 + 10, by, 90, 18, 3, rh ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.centered(g, "RESET OPTIONS", x0 + 55, by + 6, 0.75f, Draw.TEXT);
		if (m.isHud()) {
			boolean lh = Draw.in(mx, my, x0 + 106, by, 100, 18);
			Draw.round(g, x0 + 106, by, 100, 18, 3, lh ? Draw.BUTTON_HOT : Draw.BUTTON);
			Draw.centered(g, "EDIT HUD LAYOUT", x0 + 156, by + 6, 0.75f, Draw.TEXT);
		}
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		double mx = e.x() / sc, my = e.y() / sc;
		if (e.button() != 0) return super.mouseClicked(e, doubleClick);
		if (Draw.in(mx, my, x0 + 8, y0 + 8, 46, 16)) {
			onClose();
			return true;
		}
		if (Draw.in(mx, my, x0 + w - 86, y0 + 12, 76, 16)) {
			Panel.setEnabled(m, !m.enabled);
			return true;
		}
		int by = y0 + h - 26;
		if (Draw.in(mx, my, x0 + 10, by, 90, 18)) {
			for (Opt o : m.opts) o.reset();
			Panel.save();
			return true;
		}
		if (m.isHud() && Draw.in(mx, my, x0 + 106, by, 100, 18)) {
			minecraft.gui.setScreen(new HudEditorScreen(this));
			return true;
		}
		for (int i = 0; i < m.opts.size(); i++) {
			Opt o = m.opts.get(i);
			int y = rowY(i), cx = ctrlX();
			if (o instanceof Opt.Bool b && Draw.in(mx, my, x0 + 6, y - 2, w - 12, ROW - 2)) {
				b.value = !b.value;
				Panel.save();
				return true;
			}
			if (o instanceof Opt.Num n && Draw.in(mx, my, cx - 5, y, 110, 20)) {
				dragging = n;
				n.set(n.min + (n.max - n.min) * Math.max(0, Math.min(1, (mx - cx) / 100.0)));
				return true;
			}
			if (o instanceof Opt.Color c) {
				for (int k = 0; k < Opt.Color.SWATCHES.length; k++) {
					if (Draw.in(mx, my, cx + k * 15, y + 3, 13, 14)) {
						c.value = Opt.Color.SWATCHES[k];
						Panel.save();
						return true;
					}
				}
			}
			if (o instanceof Opt.Choice ch && Draw.in(mx, my, cx, y + 2, 130, 16)) {
				ch.value = (ch.value + 1) % ch.choices.length;
				Panel.save();
				return true;
			}
		}
		return super.mouseClicked(e, doubleClick);
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (dragging != null) {
			dragging.set(dragging.min + (dragging.max - dragging.min) * Math.max(0, Math.min(1, (e.x() / sc - ctrlX()) / 100.0)));
			return true;
		}
		return super.mouseDragged(e, dx, dy);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent e) {
		if (dragging != null) {
			dragging = null;
			Panel.save();
			return true;
		}
		return super.mouseReleased(e);
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		return super.keyPressed(e);
	}
}
