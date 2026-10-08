package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;

/**
 * Fullscreen Pointer (owner, 8 Oct 2026: "when I'm on full screen I can't see it, it just vanishes"). On some PCs
 * Windows stops showing the mouse pointer while Minecraft is in full screen (a driver / overlay problem; on the
 * developer's PC it stays). So in full screen, while a menu is open, Reminth hides the Windows pointer and draws the
 * same pixel arrow itself, inside the game's picture, at the mouse: always visible, exactly one pointer.
 * The home screen mod's pointer reset sees the "reminth.softCursor" property and leaves the pointer alone meanwhile.
 */
final class SoftCursor extends Module {
	// the home screen mod's arrow (PixelCursor.ARROW): X outline, W white, G grey shade
	private static final String[] ARROW = {
		"X...........",
		"XX..........",
		"XWX.........",
		"XWWX........",
		"XWWWX.......",
		"XWWWWX......",
		"XWWWWWX.....",
		"XWWWWWWX....",
		"XWWWWWWWX...",
		"XWWWWWWWWX..",
		"XWWWWWWWWWX.",
		"XWWWWWWXXXXX",
		"XWWWXWWX....",
		"XWWXXGWX....",
		"XWX..XGWX...",
		"XX...XGWX...",
		"X.....XGWX..",
		"......XGWX..",
		".......XX...",
	};

	private static boolean hiding;
	// Reminth's own game tests only: also in a window, so a window-only screenshot can show it
	private static final boolean TEST = Boolean.getBoolean("reminthhud.testSoftCursor");

	SoftCursor() {
		super("softcursor", "Fullscreen Pointer", Cat.UTILITY, "cursor", "In full screen Reminth draws the mouse pointer itself, so it never vanishes.", true, true, null, 0, 0);
	}

	private static boolean active(Minecraft mc) {
		Module m = Panel.byId("softcursor");
		return m != null && m.enabled && V.screen(mc) != null && !mc.mouseHandler.isMouseGrabbed() && (V.isFullscreen(mc) || TEST);
	}

	@Override
	public void tick(Minecraft mc) {
		update(mc);
	}

	@Override
	public void onDisable(Minecraft mc) {
		update(mc);
	}

	/** Hides the Windows pointer while active and gives it back afterwards (once). */
	static void update(Minecraft mc) {
		boolean on = active(mc);
		if (on) {
			V.osPointer(mc, false); // also again every frame: the game shows it whenever a menu opens
			System.setProperty("reminth.softCursor", "1");
		} else if (hiding) {
			if (!mc.mouseHandler.isMouseGrabbed()) V.osPointer(mc, true);
			System.clearProperty("reminth.softCursor");
		}
		if (on != hiding) com.wxsted.reminthhud.ReminthHud.LOGGER.info("Reminth fullscreen pointer: {}", on ? "drawn by Reminth (Windows' one hidden)" : "back to Windows' pointer");
		hiding = on;
	}

	/** Drawn after every menu (Panel registers it for each screen). */
	static void draw(Gfx g, Minecraft mc) {
		try {
			update(mc);
			if (!hiding) return;
			var w = mc.getWindow();
			if (w.getScreenWidth() <= 0) return;
			// window pixels -> GUI units; one art pixel = the Windows pointer's pixel size (the home mod's PixelCursor)
			float k = g.guiWidth() / (float) w.getScreenWidth();
			float px;
			try {
				px = Float.parseFloat(System.getProperty("reminth.cursorPixel", "1"));
			} catch (NumberFormatException e) {
				px = 1f;
			}
			g.push();
			g.scale(k, k);
			g.translate((float) mc.mouseHandler.xpos(), (float) mc.mouseHandler.ypos());
			g.scale(px, px);
			for (int y = 0; y < ARROW.length; y++) {
				String row = ARROW[y];
				int x = 0;
				while (x < row.length()) {
					char c = row.charAt(x);
					int end = x;
					while (end < row.length() && row.charAt(end) == c) end++;
					if (c != '.') g.fill(x, y, end, y + 1, c == 'X' ? 0xFF000000 : c == 'W' ? 0xFFFFFFFF : 0xFFBDBDBD);
					x = end;
				}
			}
			g.pop();
		} catch (Throwable ignored) {
			// never break a menu over the pointer
		}
	}
}
