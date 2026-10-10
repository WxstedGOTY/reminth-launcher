package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;

import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * One feature's own settings: switches, sliders, colour swatches, choices and text boxes, saved to the active profile.
 * HUD features also get a Size slider (the same size as in the HUD layout editor). Scrolls when there are many.
 */
public class ModuleScreen extends BaseScreen {
	private final Screen back;
	private final Module m;
	private int x0, y0, w, h;
	private float sc = 1f; // drawn on a virtual screen, scaled to fit (like the panel)
	private final Opt.Num size = new Opt.Num("_size", "Size on screen", 50, 300, 5, 100, "%");
	private final OptList list;

	public ModuleScreen(Screen back, Module m) {
		super(Component.literal(m.name));
		this.back = back;
		this.m = m;
		List<Opt> opts = new ArrayList<>();
		if (m.isHud()) opts.add(size);
		opts.addAll(m.opts);
		this.list = new OptList(opts, this::changed);
	}

	private void changed() {
		if (m.isHud()) m.scale = (float) (size.value / 100.0);
		Panel.save();
	}

	@Override
	protected void init() {
		if (m.isHud()) size.value = Math.round(m.scale * 100); // also after coming back from the layout editor
		float look = (float) (PanelLook.get().size.value / 100.0);
		int need = 66 + Math.max(1, list.opts.size()) * OptList.ROW + 34;
		int wantW = Math.round(420 * look), wantH = Math.min(need, Math.round(330 * look));
		sc = Math.min(1f, Math.min(width / (float) (wantW + 20), height / (float) (wantH + 16)));
		int vw = Math.round(width / sc), vh = Math.round(height / sc);
		w = wantW;
		h = Math.min(vh - 16, wantH);
		x0 = (vw - w) / 2;
		y0 = (vh - h) / 2;
		list.layout(x0 + 6, y0 + 52, w - 12, h - 52 - 32);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		list.stopEditing();
		Panel.save();
		Walk.setScreen(minecraft, back);
	}

	@Override
	public void removed() {
		super.removed();
		if (System.getProperty("reminthhud.testScreen") != null) com.wxsted.reminthhud.ReminthHud.LOGGER.info("Reminth panel: test options window closed", new Throwable("who closed it"));
	}

	@Override
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		if (minecraft.level == null) super.drawBackground(g, mx, my, pt);
		else if (PanelLook.get().dim.value) g.fill(0, 0, width, height, 0x66000000);
	}

	@Override
	protected void draw(Gfx g, int rmx, int rmy, float pt) {
		PanelLook.get().apply();
		if (m.isHud()) m.scale = (float) (size.value / 100.0); // the slider is in charge while this is open
		g.push();
		g.scale(sc, sc);
		try {
			drawAll(g, Math.round(rmx / sc), Math.round(rmy / sc));
		} finally {
			g.pop();
		}
	}

	private void drawAll(Gfx g, int mx, int my) {
		Draw.tile(g, x0 - 1, y0 - 1, w + 2, h + 2, 9, Draw.WINDOW_EDGE, Draw.WINDOW);
		boolean backHot = Draw.in(mx, my, x0 + 8, y0 + 8, 46, 16);
		Draw.round(g, x0 + 8, y0 + 8, 46, 16, 4, backHot ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.centered(g, "< BACK", x0 + 31, y0 + 13, 0.75f, Draw.TEXT);
		Draw.icon(g, m.icon, x0 + 62, y0 + 8, 26);
		Draw.text(g, Component.literal(m.name).withStyle(ChatFormatting.BOLD), x0 + 94, y0 + 9, 1f, Draw.TEXT, true);
		Draw.text(g, Draw.fit(m.description, w - 190, 0.75f), x0 + 94, y0 + 22, 0.75f, Draw.TEXT_DIM, true);
		int tx = x0 + w - 86, ty = y0 + 12;
		boolean th = Draw.in(mx, my, tx, ty, 76, 16);
		Draw.round(g, tx, ty, 76, 16, 3, m.enabled ? (th ? Draw.ON_HOT : Draw.ON) : (th ? Draw.OFF_HOT : Draw.OFF));
		Draw.centered(g, Component.literal(m.enabled ? "ENABLED" : "DISABLED").withStyle(ChatFormatting.BOLD), tx + 38, ty + 5, 0.75f, 0xFFFFFFFF);
		g.fill(x0 + 8, y0 + 44, x0 + w - 8, y0 + 45, 0x22FFFFFF);
		if (list.opts.isEmpty()) Draw.text(g, "No options: switch it on or off above.", x0 + 14, y0 + 60, 1f, Draw.TEXT_DIM, true);
		list.draw(g, mx, my);
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
	protected boolean click(double ex, double ey, int button) {
		double mx = ex / sc, my = ey / sc;
		if (list.click(mx, my, button)) return true;
		if (button != 0) return false;
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
			if (m.isHud()) size.value = 100;
			Panel.save();
			return true;
		}
		if (m.isHud() && Draw.in(mx, my, x0 + 106, by, 100, 18)) {
			V.setScreen(minecraft, new HudEditorScreen(this));
			return true;
		}
		return false;
	}

	@Override
	protected boolean drag(double ex, double ey, int button, double dx, double dy) {
		return list.drag(ex / sc, ey / sc);
	}

	@Override
	protected boolean release(double ex, double ey, int button) {
		return list.release();
	}

	@Override
	protected boolean scroll(double ex, double ey, double sx, double sy) {
		return list.scroll(ex / sc, ey / sc, sy);
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
			Walk.setScreen(minecraft, null);
			return true;
		}
		return Walk.key(minecraft, key, scancode, mods, true);
	}

	@Override
	protected boolean keyUp(int key, int scancode, int mods) {
		return Walk.key(minecraft, key, scancode, mods, false);
	}
}
