package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.options.controls.KeyBindsScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * The panel window: a big rounded dark window over the game. Top: the Reminth wordmark, MODS / SETTINGS, a search box
 * and close. Left: category tabs (All, HUD, Visual, Mechanic, Chat, Utility), the profiles and EDIT HUD LAYOUT. Right:
 * the features as cards, three per row - icon, name, OPTIONS and a gear, and a green ENABLED / red DISABLED button.
 */
public class PanelScreen extends Screen {
	private final Screen parent;
	private EditBox search;
	private int tab = 0; // 0 mods, 1 settings
	private Module.Cat cat = null; // null = all
	private double scroll = 0;
	private int x0, y0, w, h;
	private static final int TOP = 30, LEFT = 118;

	public PanelScreen(Screen parent) {
		super(Component.literal("Reminth"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		w = Math.min(width - 24, 600);
		h = Math.min(height - 20, 340);
		x0 = (width - w) / 2;
		y0 = (height - h) / 2;
		String keep = search == null ? "" : search.getValue();
		search = new EditBox(font, x0 + w - 166 + 18, y0 + 9, 120, 12, Component.literal("Search"));
		search.setBordered(false);
		search.setMaxLength(40);
		search.setHint(Component.literal("Search...").withStyle(ChatFormatting.GRAY));
		search.setValue(keep);
		search.setResponder(s -> scroll = 0);
		addRenderableWidget(search);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		Panel.save();
		minecraft.gui.setScreen(parent);
	}

	/* ------------------------------ what is shown ------------------------------ */

	private List<Module> shown() {
		String q = search == null ? "" : search.getValue().trim().toLowerCase(Locale.ROOT);
		List<Module> out = new ArrayList<>();
		for (Module m : Panel.MODULES) {
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
		return mainW() < 300 ? 2 : 3;
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
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		// window
		Draw.tile(g, x0 - 1, y0 - 1, w + 2, h + 2, 9, Draw.WINDOW_EDGE, Draw.WINDOW);
		// top bar
		Draw.round(g, x0, y0, w, TOP, 8, Draw.BAR);
		g.fill(x0, y0 + TOP - 8, x0 + w, y0 + TOP, Draw.BAR);
		g.fill(x0, y0 + TOP, x0 + w, y0 + TOP + 1, 0x33FFFFFF);
		Draw.icon(g, "logo", x0 + 9, y0 + 7, 16);
		Draw.text(g, Component.literal("REMINTH").withStyle(ChatFormatting.BOLD), x0 + 30, y0 + 11, 1f, Draw.TEXT, false);
		String[] tabs = {"MODS", "SETTINGS"};
		int tx = x0 + 100;
		for (int i = 0; i < tabs.length; i++) {
			int tw = font.width(tabs[i]);
			boolean hot = Draw.in(mx, my, tx - 4, y0 + 4, tw + 8, TOP - 8);
			g.text(font, tabs[i], tx, y0 + 11, tab == i ? Draw.TEXT : hot ? 0xFFDDDDDD : Draw.TEXT_FAINT, false);
			if (tab == i) g.fill(tx, y0 + TOP - 3, tx + tw, y0 + TOP - 1, Draw.ACCENT);
			tx += tw + 18;
		}
		// search box
		int sx = x0 + w - 166, sy = y0 + 6;
		Draw.tile(g, sx, sy, 136, 18, 4, search.isFocused() ? 0xFFB9B9BE : 0xFF4A4A4E, 0xFF232326);
		Draw.icon(g, "search", sx + 5, sy + 5, 9, 0xFFB4B4B8);
		// close
		int cx = x0 + w - 24;
		boolean closeHot = Draw.in(mx, my, cx, y0 + 6, 18, 18);
		Draw.round(g, cx, y0 + 6, 18, 18, 4, closeHot ? Draw.OFF : 0x00000000);
		Draw.icon(g, "close", cx + 5, y0 + 11, 8, closeHot ? 0xFFFFFFFF : 0xFFB4B4B8);

		drawLeft(g, mx, my);
		if (tab == 0) drawCards(g, mx, my);
		else drawSettings(g, mx, my);
		super.extractRenderState(g, mx, my, pt); // the search box
	}

	private void drawLeft(GuiGraphicsExtractor g, int mx, int my) {
		int lx = x0 + 6, ly = y0 + TOP + 8, lw = LEFT - 6;
		g.fill(x0 + LEFT, y0 + TOP + 1, x0 + LEFT + 1, y0 + h - 6, 0x22FFFFFF);
		Draw.text(g, "CATEGORIES", lx + 4, ly, 0.75f, Draw.TEXT_FAINT, false);
		ly += 10;
		Module.Cat[] cats = Module.Cat.values();
		for (int i = -1; i < cats.length; i++) {
			Module.Cat c = i < 0 ? null : cats[i];
			boolean sel = cat == c;
			boolean hot = Draw.in(mx, my, lx, ly, lw - 4, 18);
			if (sel || hot) Draw.round(g, lx, ly, lw - 4, 18, 4, sel ? 0xFF3A3A3D : 0xFF26262A);
			if (sel) g.fill(lx, ly + 3, lx + 2, ly + 15, Draw.ACCENT);
			Draw.icon(g, c == null ? "cat_all" : c.icon, lx + 7, ly + 4, 10, sel ? 0xFFFFFFFF : 0xFFB4B4B8);
			String label = c == null ? "All" : c.label;
			int count = 0;
			for (Module m : Panel.MODULES) if (c == null || m.cat == c) count++;
			g.text(font, label, lx + 22, ly + 5, sel ? Draw.TEXT : Draw.TEXT_DIM, false);
			Draw.text(g, Integer.toString(count), lx + lw - 16 - font.width(Integer.toString(count)) * 0.75f, ly + 6, 0.75f, Draw.TEXT_FAINT, false);
			ly += 19;
		}
		ly += 6;
		Draw.text(g, "PROFILES", lx + 4, ly, 0.75f, Draw.TEXT_FAINT, false);
		ly += 10;
		int bottom = y0 + h - 34;
		for (String p : Panel.profileNames()) {
			if (ly + 16 > bottom - 18) break;
			boolean sel = p.equals(Panel.active);
			boolean hot = Draw.in(mx, my, lx, ly, lw - 4, 16);
			if (sel || hot) Draw.round(g, lx, ly, lw - 4, 16, 4, sel ? 0xFF3A3A3D : 0xFF26262A);
			Draw.icon(g, "profile", lx + 6, ly + 4, 8, sel ? 0xFFFFFFFF : 0xFFB4B4B8);
			g.text(font, Draw.fit(p, lw - 44, 1f), lx + 19, ly + 4, sel ? Draw.TEXT : Draw.TEXT_DIM, false);
			if (sel || hot) Draw.icon(g, "pencil", lx + lw - 18, ly + 4, 8, Draw.in(mx, my, lx + lw - 21, ly, 14, 16) ? 0xFFFFFFFF : 0xFF9A9AA0);
			ly += 17;
		}
		boolean addHot = Draw.in(mx, my, lx, ly, lw - 4, 16);
		Draw.icon(g, "plus", lx + 6, ly + 4, 8, addHot ? 0xFFFFFFFF : 0xFF9A9AA0);
		Draw.text(g, "SAVE AS NEW PROFILE", lx + 19, ly + 5, 0.75f, addHot ? Draw.TEXT : Draw.TEXT_DIM, false);
		// edit HUD layout
		int by = y0 + h - 30;
		boolean hot = Draw.in(mx, my, lx, by, lw - 4, 22);
		Draw.tile(g, lx, by, lw - 4, 22, 4, hot ? Draw.TILE_EDGE_HOT : Draw.TILE_EDGE, hot ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.icon(g, "layout", lx + 7, by + 6, 10);
		Draw.text(g, "EDIT HUD LAYOUT", lx + 22, by + 8, 0.75f, Draw.TEXT, true);
	}

	private void drawCards(GuiGraphicsExtractor g, int mx, int my) {
		clampScroll();
		List<Module> list = shown();
		int mxx = mainX(), myy = mainY(), mw = mainW(), mh = mainH();
		if (list.isEmpty()) {
			Draw.centered(g, "Nothing matches \"" + search.getValue() + "\"", mxx + mw / 2f, myy + 40, 1f, Draw.TEXT_DIM);
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

	private void drawCard(GuiGraphicsExtractor g, Module m, int x, int y, int cw, int mx, int my, boolean inside) {
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
		Draw.tile(g, bx, by, bw, 16, 3, oh ? Draw.TILE_EDGE_HOT : 0xFF2A2A2D, oh ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.centered(g, "OPTIONS", bx + bw / 2f, by + 5, 0.75f, Draw.TEXT);
		boolean gh = inside && Draw.in(mx, my, bx + bw + 4, by, 16, 16);
		Draw.tile(g, bx + bw + 4, by, 16, 16, 3, gh ? Draw.TILE_EDGE_HOT : 0xFF2A2A2D, gh ? Draw.BUTTON_HOT : Draw.BUTTON);
		Draw.icon(g, "gear", bx + bw + 7, by + 3, 10);
		// ENABLED / DISABLED
		int ty = y + 79;
		boolean th = inside && Draw.in(mx, my, bx, ty, cw - 12, 15);
		int fill = m.enabled ? (th ? Draw.ON_HOT : Draw.ON) : (th ? Draw.OFF_HOT : Draw.OFF);
		Draw.round(g, bx, ty, cw - 12, 15, 3, fill);
		Draw.centered(g, Component.literal(m.enabled ? "ENABLED" : "DISABLED").withStyle(ChatFormatting.BOLD), x + cw / 2f, ty + 5, 0.75f, 0xFFFFFFFF);
		if (hot) g.setTooltipForNextFrame(font, Component.literal(m.description), mx, my);
	}

	private int settingsRowY(int i) {
		return mainY() + 4 + i * 30;
	}

	private void drawSettings(GuiGraphicsExtractor g, int mx, int my) {
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
			Draw.tile(g, bx, by, bw, 16, 3, hot ? Draw.TILE_EDGE_HOT : 0xFF2A2A2D, i == 3 ? (hot ? Draw.OFF_HOT : Draw.OFF) : hot ? Draw.BUTTON_HOT : Draw.BUTTON);
			Draw.centered(g, rows[i][2], bx + bw / 2f, by + 5, 0.75f, Draw.TEXT);
		}
		int y = settingsRowY(rows.length) + 6;
		g.textWithWordWrap(font, Component.literal("Reminth's own features, built into Reminth. Nothing here plays for you: no auto-clickers, macros, X-ray or radar. Servers' rules still apply - Reminth warns you before you join a server that bans something you have on."), x + 2, y, mw - 12, Draw.TEXT_FAINT, false);
	}

	/* ------------------------------ input ------------------------------ */

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		double mx = e.x(), my = e.y();
		if (e.button() == 0) {
			// close
			if (Draw.in(mx, my, x0 + w - 24, y0 + 6, 18, 18)) {
				onClose();
				return true;
			}
			// tabs
			String[] tabs = {"MODS", "SETTINGS"};
			int tx = x0 + 100;
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
		return super.mouseClicked(e, doubleClick);
	}

	private boolean clickLeft(double mx, double my) {
		int lx = x0 + 6, ly = y0 + TOP + 18, lw = LEFT - 6;
		Module.Cat[] cats = Module.Cat.values();
		for (int i = -1; i < cats.length; i++) {
			if (Draw.in(mx, my, lx, ly, lw - 4, 18)) {
				cat = i < 0 ? null : cats[i];
				tab = 0;
				scroll = 0;
				return true;
			}
			ly += 19;
		}
		ly += 16;
		int bottom = y0 + h - 34;
		for (String p : Panel.profileNames()) {
			if (ly + 16 > bottom - 18) break;
			if (Draw.in(mx, my, lx + lw - 21, ly, 14, 16) && (p.equals(Panel.active) || Draw.in(mx, my, lx, ly, lw - 4, 16))) {
				minecraft.gui.setScreen(new RenameScreen(this, p));
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
			minecraft.gui.setScreen(new HudEditorScreen(this));
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
				minecraft.gui.setScreen(new ModuleScreen(this, m));
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
		int x = mainX(), mw = mainW();
		for (int i = 0; i < 4; i++) {
			int y = settingsRowY(i);
			int bw = 64, bx = x + mw - 6 - bw - 6, by = y + 5;
			if (!Draw.in(mx, my, bx, by, bw, 16)) continue;
			switch (i) {
				case 0, 1 -> minecraft.gui.setScreen(new KeyBindsScreen(this, minecraft.options));
				case 2 -> minecraft.gui.setScreen(new HudEditorScreen(this));
				case 3 -> Panel.resetProfile();
				default -> {
				}
			}
			return true;
		}
		return false;
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double sx, double sy) {
		if (tab == 0 && Draw.in(mx, my, mainX(), mainY(), mainW(), mainH())) {
			scroll -= sy * 24;
			clampScroll();
			return true;
		}
		return super.mouseScrolled(mx, my, sx, sy);
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		// the panel key closes it again (unless typing in the search box)
		if (!search.isFocused() && Panel.openKey().matches(e)) {
			onClose();
			return true;
		}
		return super.keyPressed(e);
	}

	/** Small window to rename or delete a profile. */
	static final class RenameScreen extends Screen {
		private final PanelScreen back;
		private final String name;
		private EditBox box;
		private String error = "";

		RenameScreen(PanelScreen back, String name) {
			super(Component.literal("Rename profile"));
			this.back = back;
			this.name = name;
		}

		@Override
		protected void init() {
			box = new EditBox(font, width / 2 - 90, height / 2 - 14, 180, 16, Component.literal("Name"));
			box.setMaxLength(24);
			box.setValue(name);
			addRenderableWidget(box);
			setInitialFocus(box);
		}

		@Override
		public boolean isPauseScreen() {
			return false;
		}

		@Override
		public void onClose() {
			minecraft.gui.setScreen(back);
		}

		@Override
		public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
			int x = width / 2 - 110, y = height / 2 - 46;
			Draw.tile(g, x, y, 220, 96, 8, Draw.WINDOW_EDGE, Draw.WINDOW);
			Draw.centered(g, "Profile name", width / 2f, y + 10, 1f, Draw.TEXT);
			if (!error.isEmpty()) Draw.centered(g, error, width / 2f, y + 54, 0.75f, 0xFFFF6B6B);
			String[] labels = {"SAVE", "DELETE", "CANCEL"};
			for (int i = 0; i < 3; i++) {
				int bx = x + 10 + i * 68, by = y + 68;
				boolean hot = Draw.in(mx, my, bx, by, 64, 18);
				int fill = i == 0 ? (hot ? Draw.ON_HOT : Draw.ON) : i == 1 ? (hot ? Draw.OFF_HOT : Draw.OFF) : hot ? Draw.BUTTON_HOT : Draw.BUTTON;
				Draw.round(g, bx, by, 64, 18, 3, fill);
				Draw.centered(g, labels[i], bx + 32, by + 6, 0.75f, Draw.TEXT);
			}
			super.extractRenderState(g, mx, my, pt);
		}

		@Override
		public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
			int x = width / 2 - 110, y = height / 2 - 46;
			for (int i = 0; i < 3; i++) {
				int bx = x + 10 + i * 68, by = y + 68;
				if (!Draw.in(e.x(), e.y(), bx, by, 64, 18)) continue;
				if (i == 0) {
					if (box.getValue().trim().equals(name) || Panel.rename(name, box.getValue())) onClose();
					else error = "That name is empty, too long or taken.";
				} else if (i == 1) {
					if (Panel.delete(name)) onClose();
					else error = "The last profile can't be deleted.";
				} else {
					onClose();
				}
				return true;
			}
			return super.mouseClicked(e, doubleClick);
		}

		@Override
		public boolean keyPressed(KeyEvent e) {
			if (e.key() == 257 || e.key() == 335) { // Enter
				if (box.getValue().trim().equals(name) || Panel.rename(name, box.getValue())) onClose();
				else error = "That name is empty, too long or taken.";
				return true;
			}
			return super.keyPressed(e);
		}
	}
}
