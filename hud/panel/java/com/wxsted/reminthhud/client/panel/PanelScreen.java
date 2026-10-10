package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * The panel window: a big rounded dark window over the game. Top: the Reminth wordmark, MODS / SETTINGS, a search box
 * and close. Left: category tabs (All, HUD, Visual, Mechanic, Chat, Utility), the profiles and EDIT HUD LAYOUT. Right:
 * the features as cards, three per row - icon, name, OPTIONS and a gear, and a green ENABLED / red DISABLED button.
 */
public class PanelScreen extends BaseScreen {
	private final Screen parent;
	private String query = "";
	private boolean searchFocus = false;
	// The panel is laid out on a virtual screen of at least 640x370 and drawn scaled down to fit, so it looks the same
	// (three cards a row, everything in view) at any window size and GUI scale.
	private float s = 1f;
	private int vw, vh;
	private int realMx, realMy;
	private int tab = 0; // 0 mods, 1 settings
	private Module.Cat cat = null; // null = all
	private static Module.Cat lastCat = null; // "Opens on: Last category"
	private OptList look;
	private double scroll = 0;
	private int x0, y0, w, h;
	private static final int TOP = 30, LEFT = 118;
	private static final int TABS_X = 160; // after the "REMINTH MODS PANEL" title

	public PanelScreen(Screen parent) {
		super(Component.literal("Reminth"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		// 560x330 at 100% (a bit smaller than before, owner 10 Oct), resized by Panel Look's "Panel size"
		PanelLook pl = PanelLook.get();
		float size = (float) (pl.size.value / 100.0);
		int wantW = Math.round(560 * size), wantH = Math.round(330 * size);
		s = Math.min(1f, Math.min(width / (float) (wantW + 20), height / (float) (wantH + 14)));
		vw = Math.round(width / s);
		vh = Math.round(height / s);
		w = Math.min(vw - 16, wantW);
		h = Math.min(vh - 10, wantH);
		x0 = (vw - w) / 2;
		y0 = (vh - h) / 2;
		if (look == null) {
			look = new OptList(pl.opts, Panel::save);
			cat = switch (pl.openOn.value) {
				case 1 -> null;
				case 2 -> Module.Cat.HUD;
				case 3 -> Module.Cat.STREAM;
				default -> lastCat;
			};
		}
		look.layout(mainX(), settingsRowY(4) + 2, mainW() - 6, mainY() + mainH() - settingsRowY(4) - 2);
	}

	/** In a world: no blur and no dark tint, so the game stays in view (owner, 10 Oct). In menus: the usual background. */
	@Override
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		if (minecraft.level == null) super.drawBackground(g, mx, my, pt);
		else if (PanelLook.get().dim.value) g.fill(0, 0, width, height, 0x66000000);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		if (look != null) look.stopEditing();
		lastCat = cat;
		Panel.save();
		Walk.setScreen(minecraft, parent);
	}

	/** Game tests only: show a category ("STREAM") or the SETTINGS tab ("settings"). */
	void testShow(String what) {
		if (what.equals("settings")) tab = 1;
		else for (Module.Cat c : Module.Cat.values()) if (c.name().equalsIgnoreCase(what)) cat = c;
	}

	/* ------------------------------ what is shown ------------------------------ */

	private List<Module> shown() {
		String q = query.trim().toLowerCase(Locale.ROOT);
		List<Module> out = new ArrayList<>();
		for (Module m : Panel.MODULES) {
			if (m.hidden) continue;
			if (cat != null && m.cat != cat) continue;
			if (!q.isEmpty() && !m.name.toLowerCase(Locale.ROOT).contains(q) && !m.description.toLowerCase(Locale.ROOT).contains(q) && !m.cat.label.toLowerCase(Locale.ROOT).contains(q)) continue;
			out.add(m);
		}
		return out;
	}

	private int mainX() {
		return x0 + LEFT + 8;
	}

	private int mainY() {
		return y0 + TOP + 8;
	}

	private int mainW() {
		return w - LEFT - 16;
	}

	private int mainH() {
		return h - TOP - 14;
	}

	private int cols() {
		return mainW() < 300 ? 2 : PanelLook.get().compact.value && mainW() >= 400 ? 4 : 3;
	}

	private static final int GAP = 6, CARD_H = 100;

	private int cardW() {
		return (mainW() - GAP * (cols() - 1) - 6) / cols();
	}

	private int contentH() {
		int n = shown().size();
		int rows = (n + cols() - 1) / cols();
		return rows * (CARD_H + GAP);
	}

	private void clampScroll() {
		scroll = Math.max(0, Math.min(scroll, Math.max(0, contentH() - mainH())));
	}

	/* ------------------------------ drawing ------------------------------ */

	@Override
	protected void draw(Gfx g, int rmx, int rmy, float pt) {
		PanelLook.get().apply();
		realMx = rmx;
		realMy = rmy;
		int mx = Math.round(rmx / s), my = Math.round(rmy / s);
		g.push();
		g.scale(s, s);
		try {
			drawAll(g, mx, my);
		} finally {
			g.pop();
		}
	}

	private void drawAll(Gfx g, int mx, int my) {
		// window
		Draw.tile(g, x0 - 1, y0 - 1, w + 2, h + 2, 9, Draw.WINDOW_EDGE, Draw.WINDOW);
		// top bar
		Draw.round(g, x0, y0, w, TOP, 8, Draw.BAR);
		g.fill(x0, y0 + TOP - 8, x0 + w, y0 + TOP, Draw.BAR);
		g.fill(x0, y0 + TOP, x0 + w, y0 + TOP + 1, 0x33FFFFFF);
		Draw.text(g, Component.literal("REMINTH MODS PANEL").withStyle(ChatFormatting.BOLD), x0 + 12, y0 + 11, 1f, Draw.TEXT, true);
		String[] tabs = {"MODS", "SETTINGS"};
		int tx = x0 + TABS_X;
		for (int i = 0; i < tabs.length; i++) {
			int tw = font.width(tabs[i]);
			boolean hot = Draw.in(mx, my, tx - 4, y0 + 4, tw + 8, TOP - 8);
			g.text(font, tabs[i], tx, y0 + 11, tab == i ? Draw.TEXT : hot ? 0xFFDDDDDD : Draw.TEXT_FAINT, false);
			if (tab == i) g.fill(tx, y0 + TOP - 3, tx + tw, y0 + TOP - 1, Draw.ACCENT);
			tx += tw + 18;
		}
		// search box
		int sx = x0 + w - 166, sy = y0 + 6;
		Draw.tile(g, sx, sy, 136, 18, 4, searchFocus ? 0xFFB9B9BE : Draw.FIELD_EDGE, Draw.FIELD);
		Draw.icon(g, "search", sx + 5, sy + 5, 9, 0xFFB4B4B8);
		if (query.isEmpty() && !searchFocus) g.text(font, "Search...", sx + 18, sy + 5, Draw.TEXT_FAINT, false);
		else {
			String shownQ = query;
			while (font.width(shownQ) > 110 && shownQ.length() > 1) shownQ = shownQ.substring(1);
			g.text(font, shownQ, sx + 18, sy + 5, Draw.TEXT, false);
			if (searchFocus && (System.currentTimeMillis() / 500) % 2 == 0) g.fill(sx + 18 + font.width(shownQ) + 1, sy + 4, sx + 19 + font.width(shownQ) + 1, sy + 14, 0xFFFFFFFF);
		}
		// close
		int cx = x0 + w - 24;
		boolean closeHot = Draw.in(mx, my, cx, y0 + 6, 18, 18);
		Draw.round(g, cx, y0 + 6, 18, 18, 4, closeHot ? Draw.OFF : 0x00000000);
		Draw.icon(g, "close", cx + 5, y0 + 11, 8, closeHot ? 0xFFFFFFFF : 0xFFB4B4B8);

		drawLeft(g, mx, my);
		if (tab == 0) drawCards(g, mx, my);
		else drawSettings(g, mx, my);
	}

	private void drawLeft(Gfx g, int mx, int my) {
		int lx = x0 + 6, ly = y0 + TOP + 8, lw = LEFT - 6;
		g.fill(x0 + LEFT, y0 + TOP + 1, x0 + LEFT + 1, y0 + h - 6, 0x22FFFFFF);
		Draw.text(g, "CATEGORIES", lx + 4, ly, 0.75f, Draw.TEXT_FAINT, false);
		ly += 10;
		Module.Cat[] cats = Module.Cat.values();
		for (int i = -1; i < cats.length; i++) {
			Module.Cat c = i < 0 ? null : cats[i];
			boolean sel = cat == c;
			boolean hot = Draw.in(mx, my, lx, ly, lw - 4, 16);
			if (sel || hot) Draw.round(g, lx, ly, lw - 4, 16, 4, sel ? Draw.TILE : 0x26FFFFFF);
			if (sel) g.fill(lx, ly + 3, lx + 2, ly + 13, Draw.ACCENT);
			Draw.icon(g, c == null ? "cat_all" : c.icon, lx + 7, ly + 3, 10, sel ? 0xFFFFFFFF : 0xFFB4B4B8);
			String label = c == null ? "All" : c.label;
			int count = 0;
			for (Module m : Panel.MODULES) if (!m.hidden && (c == null || m.cat == c)) count++;
			Draw.text(g, label, lx + 21, ly + 4, label.length() > 9 ? 0.85f : 1f, sel ? Draw.TEXT : Draw.TEXT_DIM, true);
			Draw.text(g, Integer.toString(count), lx + lw - 8 - font.width(Integer.toString(count)) * 0.75f, ly + 5, 0.75f, Draw.TEXT_FAINT, true);
			ly += 17;
		}
		ly += 6;
		Draw.text(g, "PROFILES", lx + 4, ly, 0.75f, Draw.TEXT_FAINT, false);
		ly += 10;
		int bottom = y0 + h - 34;
		for (String p : Panel.profileNames()) {
			if (ly + 16 > bottom - 18 && !p.equals(Panel.active)) continue;
			boolean sel = p.equals(Panel.active);
			boolean hot = Draw.in(mx, my, lx, ly, lw - 4, 16);
			if (sel || hot) Draw.round(g, lx, ly, lw - 4, 16, 4, sel ? Draw.TILE : 0x26FFFFFF);
			Draw.icon(g, "profile", lx + 6, ly + 4, 8, sel ? 0xFFFFFFFF : 0xFFB4B4B8);
			g.text(font, Draw.fit(p, lw - 44, 1f), lx + 19, ly + 4, sel ? Draw.TEXT : Draw.TEXT_DIM, false);
			if (sel || hot) Draw.icon(g, "pencil", lx + lw - 18, ly + 4, 8, Draw.in(mx, my, lx + lw - 21, ly, 14, 16) ? 0xFFFFFFFF : 0xFF9A9AA0);
			ly += 17;
		}
		boolean addHot = Draw.in(mx, my, lx, ly, lw - 4, 16);
		Draw.icon(g, "plus", lx + 6, ly + 4, 8, addHot ? 0xFFFFFFFF : 0xFF9A9AA0);
		Draw.text(g, "SAVE AS NEW PROFILE", lx + 19, ly + 5, 0.75f, addHot ? Draw.TEXT : Draw.TEXT_DIM, false);
		// edit HUD layout
		// EDIT HUD LAYOUT stands out (owner, 10 Oct: players must find it): same colours, but a solid button, a white
		// outline, bold text and - until it has been opened once - a soft pulse and an arrow pointing at it
		int by = y0 + h - 30;
		boolean hot = Draw.in(mx, my, lx, by, lw - 4, 22);
		if (!Panel.layoutSeen) {
			float p = (float) ((Math.sin(System.currentTimeMillis() / 300.0) + 1) / 2);
			Draw.round(g, lx - 2, by - 2, lw, 26, 6, Draw.alpha(0xFFFFFFFF, 0.15 + 0.35 * p));
		}
		Draw.tile(g, lx, by, lw - 4, 22, 4, hot ? 0xFFFFFFFF : 0xDDFFFFFF, hot ? 0xFF8A8A8F : 0xFF6F6F73);
		Draw.icon(g, "layout", lx + 7, by + 6, 10);
		Draw.text(g, Component.literal("EDIT HUD LAYOUT").withStyle(ChatFormatting.BOLD), lx + 21, by + 8, 0.72f, Draw.TEXT, true);
		if (!Panel.layoutSeen) {
			int ax = lx + lw / 2 - 3;
			int ay = by - 9 + (int) Math.round(Math.sin(System.currentTimeMillis() / 250.0) * 1.5);
			for (int i = 0; i < 4; i++) g.fill(ax - 3 + i, ay + i, ax + 4 - i, ay + i + 1, 0xFFFFFFFF); // a small arrow pointing down
			Draw.centered(g, "Move your HUD here", lx + lw / 2f - 2, ay - 8, 0.6f, Draw.TEXT);
		}
	}

	private void drawCards(Gfx g, int mx, int my) {
		clampScroll();
		List<Module> list = shown();
		int mxx = mainX(), myy = mainY(), mw = mainW(), mh = mainH();
		if (list.isEmpty()) {
			Draw.centered(g, "Nothing matches \"" + query + "\"", mxx + mw / 2f, myy + 40, 1f, Draw.TEXT_DIM);
			return;
		}
		g.enableScissor(mxx, myy, mxx + mw, myy + mh);
		int cw = cardW();
		for (int i = 0; i < list.size(); i++) {
			Module m = list.get(i);
			int cx = mxx + (i % cols()) * (cw + GAP);
			int cy = myy + (i / cols()) * (CARD_H + GAP) - (int) scroll;
			if (cy + CARD_H < myy || cy > myy + mh) continue;
			drawCard(g, m, cx, cy, cw, mx, my, Draw.in(mx, my, mxx, myy, mw, mh));
		}
		g.disableScissor();
		// scrollbar
		int ch = contentH();
		if (ch > mh) {
			int barH = Math.max(20, mh * mh / ch);
			int barY = myy + (int) ((mh - barH) * (scroll / (ch - mh)));
			Draw.round(g, mxx + mw - 3, barY, 3, barH, 1, 0x66FFFFFF);
		}
	}

	private void drawCard(Gfx g, Module m, int x, int y, int cw, int mx, int my, boolean inside) {
		boolean hot = inside && Draw.in(mx, my, x, y, cw, CARD_H);
		Draw.tile(g, x, y, cw, CARD_H, 6, hot ? Draw.TILE_EDGE_HOT : Draw.TILE_EDGE, hot ? Draw.TILE_HOT : Draw.TILE);
		Draw.icon(g, m.icon, x + (cw - 30) / 2, y + 9, 30, m.enabled ? 0xFFFFFFFF : 0xFFC8C8CC);
		Draw.centered(g, Draw.fit(m.name, cw - 10, 1f), x + cw / 2f, y + 45, 1f, Draw.TEXT);
		if (m.isNew) {
			int tw = font.width("NEW");
			Draw.round(g, x + cw - tw - 10, y + 5, tw + 6, 11, 3, Draw.NEW_TAG);
			Draw.text(g, "NEW", x + cw - tw - 7, y + 7, 1f, 0xFFFFFFFF, false);
		}
		// OPTIONS + gear
		int bx = x + 6, by = y + 59, bw = cw - 12 - 20;
		boolean oh = inside && Draw.in(mx, my, bx, by, bw, 16);
		Draw.tile(g, bx, by, bw, 16, 3, oh ? Draw.TILE_EDGE_HOT : Draw.BUTTON_EDGE, oh ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.centered(g, "OPTIONS", bx + bw / 2f, by + 5, 0.75f, Draw.TEXT);
		boolean gh = inside && Draw.in(mx, my, bx + bw + 4, by, 16, 16);
		Draw.tile(g, bx + bw + 4, by, 16, 16, 3, gh ? Draw.TILE_EDGE_HOT : Draw.BUTTON_EDGE, gh ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.icon(g, "gear", bx + bw + 7, by + 3, 10);
		// ENABLED / DISABLED
		int ty = y + 79;
		boolean th = inside && Draw.in(mx, my, bx, ty, cw - 12, 15);
		int fill = m.enabled ? (th ? Draw.ON_HOT : Draw.ON) : (th ? Draw.OFF_HOT : Draw.OFF);
		Draw.round(g, bx, ty, cw - 12, 15, 3, fill);
		Draw.centered(g, Component.literal(m.enabled ? "ENABLED" : "DISABLED").withStyle(ChatFormatting.BOLD), x + cw / 2f, ty + 5, 0.75f, 0xFFFFFFFF);
		// the description over the icon and name only (not over the buttons)
		if (hot && my < y + 56 && PanelLook.get().tooltips.value) g.setTooltipForNextFrame(font, Component.literal(m.description), realMx, realMy);
	}

	private int settingsRowY(int i) {
		return mainY() + 4 + i * 30;
	}

	private void drawSettings(Gfx g, int mx, int my) {
		int x = mainX(), mw = mainW();
		String[][] rows = {
			{"Open this panel", "Key: " + Panel.openKey().getTranslatedKeyMessage().getString(), "CHANGE KEY"},
			{"Zoom", "Key: " + Panel.zoomKey().getTranslatedKeyMessage().getString(), "CHANGE KEY"},
			{"HUD layout", "Move and resize everything on screen", "EDIT"},
			{"Reset profile", "Every feature of \"" + Panel.active + "\" back to how it comes", "RESET"},
		};
		for (int i = 0; i < rows.length; i++) {
			int y = settingsRowY(i);
			Draw.tile(g, x, y, mw - 6, 26, 5, Draw.TILE_EDGE, Draw.TILE);
			g.text(font, rows[i][0], x + 8, y + 4, Draw.TEXT, false);
			Draw.text(g, rows[i][1], x + 8, y + 15, 0.75f, Draw.TEXT_DIM, false);
			int bw = 64, bx = x + mw - 6 - bw - 6, by = y + 5;
			boolean hot = Draw.in(mx, my, bx, by, bw, 16);
			Draw.tile(g, bx, by, bw, 16, 3, hot ? Draw.TILE_EDGE_HOT : Draw.BUTTON_EDGE, i == 3 ? (hot ? Draw.OFF_HOT : Draw.OFF) : hot ? Draw.BUTTON_HOT : Draw.BUTTON);
			Draw.centered(g, rows[i][2], bx + bw / 2f, by + 5, 0.75f, Draw.TEXT);
		}
		look.draw(g, mx, my);
	}

	/* ------------------------------ input ------------------------------ */

	@Override
	protected boolean click(double ex, double ey, int button) {
		double mx = ex / s, my = ey / s;
		if (button == 0) {
			searchFocus = Draw.in(mx, my, x0 + w - 166, y0 + 6, 136, 18);
			if (searchFocus) return true;
			// close
			if (Draw.in(mx, my, x0 + w - 24, y0 + 6, 18, 18)) {
				onClose();
				return true;
			}
			// tabs
			String[] tabs = {"MODS", "SETTINGS"};
			int tx = x0 + TABS_X;
			for (int i = 0; i < tabs.length; i++) {
				int tw = font.width(tabs[i]);
				if (Draw.in(mx, my, tx - 4, y0 + 4, tw + 8, TOP - 8)) {
					tab = i;
					scroll = 0;
					return true;
				}
				tx += tw + 18;
			}
			if (clickLeft(mx, my)) return true;
			if (tab == 0 && clickCards(mx, my)) return true;
			if (tab == 1 && clickSettings(mx, my)) return true;
		}
		return false;
	}

	private boolean clickLeft(double mx, double my) {
		int lx = x0 + 6, ly = y0 + TOP + 18, lw = LEFT - 6;
		Module.Cat[] cats = Module.Cat.values();
		for (int i = -1; i < cats.length; i++) {
			if (Draw.in(mx, my, lx, ly, lw - 4, 16)) {
				cat = i < 0 ? null : cats[i];
				tab = 0;
				scroll = 0;
				return true;
			}
			ly += 17;
		}
		ly += 16;
		int bottom = y0 + h - 34;
		for (String p : Panel.profileNames()) {
			if (ly + 16 > bottom - 18 && !p.equals(Panel.active)) continue;
			if (Draw.in(mx, my, lx + lw - 21, ly, 14, 16) && (p.equals(Panel.active) || Draw.in(mx, my, lx, ly, lw - 4, 16))) {
				V.setScreen(minecraft, new RenameScreen(this, p));
				return true;
			}
			if (Draw.in(mx, my, lx, ly, lw - 4, 16)) {
				Panel.switchTo(p);
				return true;
			}
			ly += 17;
		}
		if (Draw.in(mx, my, lx, ly, lw - 4, 16)) {
			Panel.saveAsNew();
			return true;
		}
		if (Draw.in(mx, my, lx, y0 + h - 30, lw - 4, 22)) {
			V.setScreen(minecraft, new HudEditorScreen(this));
			return true;
		}
		return false;
	}

	private boolean clickCards(double mx, double my) {
		int mxx = mainX(), myy = mainY();
		if (!Draw.in(mx, my, mxx, myy, mainW(), mainH())) return false;
		List<Module> list = shown();
		int cw = cardW();
		for (int i = 0; i < list.size(); i++) {
			Module m = list.get(i);
			int x = mxx + (i % cols()) * (cw + GAP);
			int y = myy + (i / cols()) * (CARD_H + GAP) - (int) scroll;
			int bx = x + 6, bw = cw - 12 - 20;
			if (Draw.in(mx, my, bx, y + 59, bw + 24, 16)) {
				Screen own = m.optionsScreen(this);
				Walk.setScreen(minecraft, own != null ? own : new ModuleScreen(this, m));
				return true;
			}
			if (Draw.in(mx, my, bx, y + 79, cw - 12, 15)) {
				Panel.setEnabled(m, !m.enabled);
				return true;
			}
		}
		return false;
	}

	private boolean clickSettings(double mx, double my) {
		if (look.click(mx, my, 0)) {
			init(); // the size may have changed
			return true;
		}
		int x = mainX(), mw = mainW();
		for (int i = 0; i < 4; i++) {
			int y = settingsRowY(i);
			int bw = 64, bx = x + mw - 6 - bw - 6, by = y + 5;
			if (!Draw.in(mx, my, bx, by, bw, 16)) continue;
			switch (i) {
				case 0, 1 -> V.setScreen(minecraft, V.controlsScreen(this, minecraft.options));
				case 2 -> V.setScreen(minecraft, new HudEditorScreen(this));
				case 3 -> Panel.resetProfile();
				default -> {
				}
			}
			return true;
		}
		return false;
	}

	@Override
	protected boolean scroll(double rmx, double rmy, double sx, double sy) {
		double mx = rmx / s, my = rmy / s;
		if (tab == 1) return look.scroll(mx, my, sy);
		if (tab == 0 && Draw.in(mx, my, mainX(), mainY(), mainW(), mainH())) {
			scroll -= sy * 24;
			clampScroll();
			return true;
		}
		return false;
	}

	@Override
	protected boolean drag(double ex, double ey, int button, double dx, double dy) {
		return tab == 1 && look.drag(ex / s, ey / s);
	}

	@Override
	protected boolean release(double ex, double ey, int button) {
		if (tab == 1 && look.release()) {
			init(); // the size may have changed
			return true;
		}
		return false;
	}

	@Override
	protected boolean typed(String text) {
		if (searchFocus && query.length() < 40) {
			query += text;
			scroll = 0;
			tab = 0;
			return true;
		}
		return false;
	}

	@Override
	protected boolean key(int key, int scancode, int mods) {
		if (searchFocus) {
			int k = key;
			if (k == InputConstants.KEY_BACKSPACE && !query.isEmpty()) { // Backspace
				query = query.substring(0, query.length() - 1);
				scroll = 0;
				return true;
			}
			if (k == InputConstants.KEY_ESCAPE || k == InputConstants.KEY_RETURN || k == InputConstants.KEY_NUMPADENTER) { // Esc / Enter: leave the box
				searchFocus = false;
				return true;
			}
			return true; // typing never triggers the panel's or the game's keys
		}
		// the panel key closes it again, and so does the inventory key (E)
		if (V.matches(Panel.openKey(), key, scancode, mods) || Walk.closes(minecraft, key, scancode, mods)) {
			onClose();
			return true;
		}
		// W A S D, jump, sprint and sneak still move you
		return Walk.key(minecraft, key, scancode, mods, true);
	}

	@Override
	protected boolean keyUp(int key, int scancode, int mods) {
		return Walk.key(minecraft, key, scancode, mods, false);
	}

	/** Small window to rename or delete a profile. */
	/** Small window to rename or delete a profile. Its text box is drawn by the panel itself (same on every version). */
	static final class RenameScreen extends BaseScreen {
		private final PanelScreen back;
		private final String name;
		private String value;
		private String error = "";

		RenameScreen(PanelScreen back, String name) {
			super(Component.literal("Rename profile"));
			this.back = back;
			this.name = name;
			this.value = name;
		}

		@Override
		public boolean isPauseScreen() {
			return false;
		}

		@Override
		public void onClose() {
			V.setScreen(minecraft, back);
		}

		private void save() {
			if (value.trim().equals(name) || Panel.rename(name, value)) onClose();
			else error = "That name is empty, too long or taken.";
		}

		@Override
		protected void draw(Gfx g, int mx, int my, float pt) {
			int x = width / 2 - 110, y = height / 2 - 46;
			Draw.tile(g, x, y, 220, 96, 8, Draw.WINDOW_EDGE, Draw.WINDOW);
			Draw.centered(g, "Profile name", width / 2f, y + 10, 1f, Draw.TEXT);
			// the text box
			int bx0 = width / 2 - 90, by0 = height / 2 - 14;
			Draw.tile(g, bx0, by0, 180, 16, 3, 0xFFB9B9BE, Draw.FIELD);
			String shown = value;
			while (font.width(shown) > 170 && shown.length() > 1) shown = shown.substring(1);
			g.text(font, shown, bx0 + 5, by0 + 4, Draw.TEXT, false);
			if ((System.currentTimeMillis() / 500) % 2 == 0) g.fill(bx0 + 6 + font.width(shown), by0 + 3, bx0 + 7 + font.width(shown), by0 + 13, 0xFFFFFFFF);
			if (!error.isEmpty()) Draw.centered(g, error, width / 2f, y + 54, 0.75f, 0xFFFF6B6B);
			String[] labels = {"SAVE", "DELETE", "CANCEL"};
			for (int i = 0; i < 3; i++) {
				int bx = x + 10 + i * 68, by = y + 68;
				boolean hot = Draw.in(mx, my, bx, by, 64, 18);
				int fill = i == 0 ? (hot ? Draw.ON_HOT : Draw.ON) : i == 1 ? (hot ? Draw.OFF_HOT : Draw.OFF) : hot ? Draw.BUTTON_HOT : Draw.BUTTON;
				Draw.round(g, bx, by, 64, 18, 3, fill);
				Draw.centered(g, labels[i], bx + 32, by + 6, 0.75f, Draw.TEXT);
			}
		}

		@Override
		protected boolean click(double ex, double ey, int button) {
			int x = width / 2 - 110, y = height / 2 - 46;
			for (int i = 0; i < 3; i++) {
				int bx = x + 10 + i * 68, by = y + 68;
				if (!Draw.in(ex, ey, bx, by, 64, 18)) continue;
				if (i == 0) save();
				else if (i == 1) {
					if (Panel.delete(name)) onClose();
					else error = "The last profile can't be deleted.";
				} else {
					onClose();
				}
				return true;
			}
			return false;
		}

		@Override
		protected boolean typed(String text) {
			if (value.length() + text.length() <= 24) value += text;
			error = "";
			return true;
		}

		@Override
		protected boolean key(int key, int scancode, int mods) {
			if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
				save();
				return true;
			}
			if (key == InputConstants.KEY_BACKSPACE) {
				if (!value.isEmpty()) value = value.substring(0, value.length() - 1);
				error = "";
				return true;
			}
			return false;
		}
	}
}
