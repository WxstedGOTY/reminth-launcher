package com.wxsted.reminthhud.client.panel;

import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * The Stream Text studio: a see-through window on the right with the eight text lines (switch one on, click it to type)
 * and the picked line's settings; the rest of the screen is the game, where the texts can be dragged to their place.
 */
public class TextStudioScreen extends BaseScreen {
	private final Screen back;
	private int sel;
	private float sc = 1f;
	private int x0, y0, w, h;
	private final OptList list;
	private StreamText dragging;
	private double grabX, grabY;
	private static final int ROWS_Y = 30, ROW = 18;

	public TextStudioScreen(Screen back, int index) {
		super(Component.literal("Stream Text"));
		this.back = back;
		this.sel = index;
		this.list = new OptList(line(index).opts, Panel::save);
	}

	private static StreamText line(int i) {
		return (StreamText) Panel.byId("streamtext" + (i + 1));
	}

	@Override
	protected void init() {
		sc = Math.min(1f, height / 300f);
		int vw = Math.round(width / sc), vh = Math.round(height / sc);
		w = 240;
		h = vh - 16;
		x0 = vw - w - 8;
		y0 = 8;
		int listY = y0 + ROWS_Y + StreamText.COUNT * ROW + 8;
		list.layout(x0 + 4, listY, w - 8, y0 + h - 30 - listY);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		if (minecraft.level == null) super.drawBackground(g, mx, my, pt);
	}

	@Override
	public void onClose() {
		list.stopEditing();
		Panel.save();
		V.setScreen(minecraft, back);
	}

	private void pick(int i) {
		sel = i;
		list.setOpts(line(i).opts);
		list.edit(line(i).text);
	}

	@Override
	protected void draw(Gfx g, int rmx, int rmy, float pt) {
		PanelLook.get().apply();
		// a frame around every text that is on, the picked one brighter (in screen pixels, where they are drawn)
		for (int i = 0; i < StreamText.COUNT; i++) {
			StreamText t = line(i);
			if (!t.enabled) continue;
			int fx = t.drawX - 2, fy = t.drawY - 2, fw = Math.round(t.lastW * t.scale) + 4, fh = Math.round(t.lastH * t.scale) + 4;
			g.outline(fx, fy, fw, fh, i == sel ? 0xFFFFFFFF : 0x66FFFFFF);
			Draw.text(g, Integer.toString(i + 1), fx + 1, fy - 7, 0.75f, i == sel ? 0xFFFFFFFF : 0xAAFFFFFF, true);
		}
		g.push();
		g.scale(sc, sc);
		try {
			drawWindow(g, Math.round(rmx / sc), Math.round(rmy / sc));
		} finally {
			g.pop();
		}
	}

	private void drawWindow(Gfx g, int mx, int my) {
		Draw.tile(g, x0 - 1, y0 - 1, w + 2, h + 2, 8, Draw.WINDOW_EDGE, Draw.WINDOW);
		Draw.text(g, Component.literal("STREAM TEXT").withStyle(ChatFormatting.BOLD), x0 + 10, y0 + 10, 1f, Draw.TEXT, true);
		boolean doneHot = Draw.in(mx, my, x0 + w - 56, y0 + 6, 48, 16);
		Draw.round(g, x0 + w - 56, y0 + 6, 48, 16, 3, doneHot ? Draw.ON_HOT : Draw.ON);
		Draw.centered(g, "DONE", x0 + w - 32, y0 + 11, 0.75f, Draw.TEXT);
		for (int i = 0; i < StreamText.COUNT; i++) {
			StreamText t = line(i);
			int ry = y0 + ROWS_Y + i * ROW;
			boolean hot = Draw.in(mx, my, x0 + 4, ry, w - 8, ROW - 1);
			if (i == sel || hot) Draw.round(g, x0 + 4, ry, w - 8, ROW - 1, 4, i == sel ? Draw.TILE : 0x26FFFFFF);
			int sx = x0 + 8;
			Draw.round(g, sx, ry + 3, 22, 11, 5, t.enabled ? Draw.ON : 0xFF55555A);
			Draw.round(g, t.enabled ? sx + 12 : sx + 1, ry + 4, 9, 9, 4, 0xFFFFFFFF);
			g.text(Draw.font(), (i + 1) + ".", x0 + 36, ry + 5, Draw.TEXT_DIM, true);
			String preview = ChatFormatting.stripFormatting(t.text.value.replaceAll("&([0-9a-fk-orA-FK-OR])", "")).replace('|', ' ');
			g.text(Draw.font(), Draw.fit(preview.isEmpty() ? "(empty)" : preview, w - 70, 1f), x0 + 50, ry + 5, t.enabled ? Draw.TEXT : Draw.TEXT_FAINT, true);
		}
		g.fill(x0 + 6, y0 + ROWS_Y + StreamText.COUNT * ROW + 3, x0 + w - 6, y0 + ROWS_Y + StreamText.COUNT * ROW + 4, 0x22FFFFFF);
		list.draw(g, mx, my);
		Draw.text(g, "Drag texts on the screen to move them.", x0 + 8, y0 + h - 24, 0.75f, Draw.TEXT_DIM, true);
		Draw.text(g, "&c red  &a green  &9 blue  &e yellow  &l bold  | new line", x0 + 8, y0 + h - 14, 0.75f, Draw.TEXT_FAINT, true);
	}

	private StreamText textAt(double gx, double gy) {
		for (int i = StreamText.COUNT - 1; i >= 0; i--) {
			StreamText t = line(i);
			if (t.enabled && Draw.in(gx, gy, t.drawX - 2, t.drawY - 2, Math.round(t.lastW * t.scale) + 4, Math.round(t.lastH * t.scale) + 4)) return t;
		}
		return null;
	}

	@Override
	protected boolean click(double ex, double ey, int button) {
		double mx = ex / sc, my = ey / sc;
		if (Draw.in(mx, my, x0, y0, w, h)) {
			if (list.click(mx, my, button)) return true;
			if (button != 0) return true;
			if (Draw.in(mx, my, x0 + w - 56, y0 + 6, 48, 16)) {
				onClose();
				return true;
			}
			for (int i = 0; i < StreamText.COUNT; i++) {
				int ry = y0 + ROWS_Y + i * ROW;
				if (Draw.in(mx, my, x0 + 6, ry, 28, ROW - 1)) {
					Panel.setEnabled(line(i), !line(i).enabled);
					pick(i);
					return true;
				}
				if (Draw.in(mx, my, x0 + 4, ry, w - 8, ROW - 1)) {
					pick(i);
					return true;
				}
			}
			return true;
		}
		list.stopEditing();
		StreamText t = textAt(ex, ey);
		if (t != null && button == 0) {
			pick(t.index);
			list.stopEditing();
			dragging = t;
			grabX = ex - t.drawX;
			grabY = ey - t.drawY;
			return true;
		}
		return false;
	}

	@Override
	protected boolean drag(double ex, double ey, int button, double dx, double dy) {
		if (dragging != null) {
			int nx = (int) Math.round(ex - grabX), ny = (int) Math.round(ey - grabY);
			dragging.placeAt(nx, ny, width, height);
			return true;
		}
		return list.drag(ex / sc, ey / sc);
	}

	@Override
	protected boolean release(double ex, double ey, int button) {
		if (dragging != null) {
			dragging = null;
			Panel.save();
			return true;
		}
		return list.release();
	}

	@Override
	protected boolean scroll(double ex, double ey, double sx, double sy) {
		if (list.scroll(ex / sc, ey / sc, sy)) return true;
		StreamText t = textAt(ex, ey);
		if (t != null) { // scroll on a text: bigger / smaller
			t.size.set(t.size.value + (sy > 0 ? 0.25 : -0.25));
			Panel.save();
			return true;
		}
		return false;
	}

	@Override
	protected boolean typed(String text) {
		return list.typed(text);
	}

	@Override
	protected boolean key(int key, int scancode, int mods) {
		if (list.key(key)) return true;
		if (Walk.closes(minecraft, key, scancode, mods) || V.matches(Panel.openKey(), key, scancode, mods)) {
			Panel.save();
			V.setScreen(minecraft, null);
			return true;
		}
		return Walk.key(minecraft, key, scancode, mods, true);
	}

	@Override
	protected boolean keyUp(int key, int scancode, int mods) {
		return Walk.key(minecraft, key, scancode, mods, false);
	}
}
