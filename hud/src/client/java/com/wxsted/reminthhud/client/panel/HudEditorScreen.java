package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * "Edit HUD layout": every switched-on HUD feature with a box around it. Drag to move, scroll over one to make it
 * bigger or smaller, right-click to put it back where it came. Positions are saved per profile.
 */
public class HudEditorScreen extends BaseScreen {
	private final Screen back;
	private Module dragging;
	private double grabX, grabY;

	public HudEditorScreen(Screen back) {
		super(Component.literal("Edit HUD layout"));
		this.back = back;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		Panel.save();
		V.setScreen(minecraft, back);
	}

	@Override
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		if (minecraft.level == null) super.drawBackground(g, mx, my, pt);
		else g.fill(0, 0, width, height, 0x40000000);
	}

	private Module at(double mx, double my) {
		for (int i = Panel.MODULES.size() - 1; i >= 0; i--) {
			Module m = Panel.MODULES.get(i);
			if (!m.enabled || !m.isHud()) continue;
			int x = m.drawX, y = m.drawY;
			if (Draw.in(mx, my, x - 2, y - 2, Math.round(m.lastW * m.scale) + 4, Math.round(m.lastH * m.scale) + 4)) return m;
		}
		return null;
	}

	@Override
	protected void draw(Gfx g, int mx, int my, float pt) {
		// centre lines to line things up
		g.fill(width / 2, 0, width / 2 + 1, height, 0x22FFFFFF);
		g.fill(0, height / 2, width, height / 2 + 1, 0x22FFFFFF);
		Panel.drawHud(g, minecraft, true);
		Module hot = dragging != null ? dragging : at(mx, my);
		for (Module m : Panel.MODULES) {
			if (!m.enabled || !m.isHud()) continue;
			int x = m.drawX, y = m.drawY;
			int bw = Math.round(m.lastW * m.scale), bh = Math.round(m.lastH * m.scale);
			g.outline(x - 2, y - 2, bw + 4, bh + 4, m == hot ? 0xFFFFFFFF : 0x80FFFFFF);
			if (m == hot) {
				String t = m.name + "  " + Math.round(m.scale * 100) + "%";
				int ty = y - 13 < 0 ? y + bh + 4 : y - 13;
				Draw.round(g, x - 2, ty, font.width(t) + 6, 11, 2, 0xD0000000);
				g.text(font, t, x + 1, ty + 2, 0xFFFFFFFF, false);
			}
		}
		// toolbar
		String help = "Drag to move  -  Scroll to resize  -  Right-click to reset";
		int tw = font.width(help) + 90;
		int tx = (width - tw) / 2, ty = 6;
		Draw.tile(g, tx, ty, tw, 22, 6, Draw.WINDOW_EDGE, Draw.WINDOW);
		g.text(font, help, tx + 8, ty + 7, Draw.TEXT_DIM, false);
		int bx = tx + tw - 70, by = ty + 3;
		boolean dh = Draw.in(mx, my, bx, by, 64, 16);
		Draw.round(g, bx, by, 64, 16, 3, dh ? Draw.ON_HOT : Draw.ON);
		Draw.centered(g, "DONE", bx + 32, by + 5, 0.75f, 0xFFFFFFFF);
		drawWidgets(g, mx, my, pt);
	}

	private boolean onDone(double mx, double my) {
		String help = "Drag to move  -  Scroll to resize  -  Right-click to reset";
		int tw = font.width(help) + 90;
		int tx = (width - tw) / 2;
		return Draw.in(mx, my, tx + tw - 70, 9, 64, 16);
	}

	@Override
	protected boolean click(double ex, double ey, int button) {
		if (button == 0 && onDone(ex, ey)) {
			onClose();
			return true;
		}
		Module m = at(ex, ey);
		if (m != null && button == 1) {
			m.resetPlacement();
			Panel.save();
			return true;
		}
		if (m != null && button == 0) {
			dragging = m;
			grabX = ex - m.drawX;
			grabY = ey - m.drawY;
			return true;
		}
		return false;
	}

	@Override
	protected boolean drag(double ex, double ey, int button, double dx, double dy) {
		if (dragging != null) {
			int bw = Math.round(dragging.lastW * dragging.scale), bh = Math.round(dragging.lastH * dragging.scale);
			int x = (int) Math.round(ex - grabX), y = (int) Math.round(ey - grabY);
			x = Math.max(0, Math.min(width - bw, x));
			y = Math.max(0, Math.min(height - bh, y));
			// snap to the centre lines
			if (Math.abs(x + bw / 2 - width / 2) < 4) x = width / 2 - bw / 2;
			if (Math.abs(y + bh / 2 - height / 2) < 4) y = height / 2 - bh / 2;
			dragging.placeAt(x, y, width, height);
			return true;
		}
		return false;
	}

	@Override
	protected boolean release(double ex, double ey, int button) {
		if (dragging != null) {
			dragging = null;
			Panel.save();
			return true;
		}
		return false;
	}

	@Override
	protected boolean scroll(double mx, double my, double sx, double sy) {
		Module m = at(mx, my);
		if (m != null) {
			int x = m.drawX, y = m.drawY;
			m.scale = Math.max(0.5f, Math.min(3f, Math.round((m.scale + (sy > 0 ? 0.1f : -0.1f)) * 10f) / 10f));
			m.placeAt(x, y, width, height);
			Panel.save();
			return true;
		}
		return false;
	}
}
