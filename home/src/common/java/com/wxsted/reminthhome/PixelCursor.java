package com.wxsted.reminthhome;

import java.lang.reflect.Method;
import java.nio.ByteBuffer;

/**
 * Reminth's pixel cursor (the owner, 7 Oct 2026): a Minecraft-looking pixel arrow, pointing hand and text beam with a
 * black outline, used in every game menu. Made from the small pixel drawings below, each pixel 2-4 screen pixels big
 * depending on the screen. GLFW is called by name (it is not on the compile path of every build); anything failing
 * leaves the game's own cursor.
 * Set again with every window-mode change (CursorFix), which also cures the pointer that vanishes after F11.
 */
public final class PixelCursor {
	private PixelCursor() {
	}

	// X = black outline, W = white, G = light grey shade, . = see-through
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
	private static final String[] HAND = {
		"....XX..........",
		"...XWWX.........",
		"...XWWX.........",
		"...XWWX.........",
		"...XWWXXX.......",
		"...XWWXWWXXX....",
		"...XWWXWWXWWXX..",
		"XX.XWWXWWXWWXWX.",
		"XWXXWWWWWWWWXWX.",
		"XWWXWWWWWWWWWWX.",
		".XWWWWWWWWWWWWX.",
		"..XWWWWWWWWWWWX.",
		"..XWWWWWWWWWWX..",
		"...XWWWWWWWWWX..",
		"....XWWWWWWWX...",
		"....XGGGGGGGX...",
		"....XXXXXXXXX...",
	};
	private static final String[] BEAM = {
		"XXX.XXX",
		"XWWXWWX",
		"XXXWXXX",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"..XWX..",
		"XXXWXXX",
		"XWWXWWX",
		"XXX.XXX",
	};

	private static long arrow, hand, beam;
	private static boolean failed;
	private static volatile boolean enabled = true;
	// Minecraft 26.3 runs its window on SDL3 instead of GLFW (Compat.sdl()): cursors are made with SDL there.
	private static boolean sdl;

	static void setSdl(boolean on) {
		sdl = on;
	}

	static void setEnabled(boolean on) {
		enabled = on;
	}

	public static boolean enabled() {
		return enabled && !failed;
	}

	/** How big one pixel of the drawing is on screen: 2 on a 1080p screen, more on bigger ones. */
	private static int scale(int screenHeight) {
		return screenHeight >= 2000 ? 4 : screenHeight >= 1400 ? 3 : 2;
	}

	private static long make(String[] art, int hotX, int hotY, int s) throws Exception {
		int w = art[0].length() * s, h = art.length * s;
		ByteBuffer buf = ByteBuffer.allocateDirect(w * h * 4);
		for (int y = 0; y < h; y++) {
			String row = art[y / s];
			for (int x = 0; x < w; x++) {
				char c = row.charAt(x / s);
				int rgba = switch (c) {
					case 'X' -> 0x000000FF;
					case 'W' -> 0xFFFFFFFF;
					case 'G' -> 0xBDBDBDFF;
					default -> 0;
				};
				buf.put((byte) (rgba >>> 24)).put((byte) (rgba >>> 16)).put((byte) (rgba >>> 8)).put((byte) rgba);
			}
		}
		buf.flip();
		if (sdl) {
			// SDL_PIXELFORMAT_ABGR8888 = bytes R, G, B, A in memory (as written above); SDL copies the pixels
			Class<?> surfaceApi = Class.forName("org.lwjgl.sdl.SDLSurface");
			Class<?> surfaceType = Class.forName("org.lwjgl.sdl.SDL_Surface");
			Object surface = surfaceApi.getMethod("SDL_CreateSurfaceFrom", int.class, int.class, int.class, ByteBuffer.class, int.class).invoke(null, w, h, 376840196, buf, w * 4);
			long cursor = (Long) Class.forName("org.lwjgl.sdl.SDLMouse").getMethod("SDL_CreateColorCursor", surfaceType, int.class, int.class).invoke(null, surface, hotX * s, hotY * s);
			surfaceApi.getMethod("SDL_DestroySurface", surfaceType).invoke(null, surface);
			return cursor;
		}
		Class<?> image = Class.forName("org.lwjgl.glfw.GLFWImage");
		Object img = image.getMethod("malloc").invoke(null);
		image.getMethod("set", int.class, int.class, ByteBuffer.class).invoke(img, w, h, buf);
		Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW");
		return (Long) glfw.getMethod("glfwCreateCursor", image, int.class, int.class).invoke(null, img, hotX * s, hotY * s);
	}

	private static synchronized void build(int screenHeight) {
		if (arrow != 0L || failed) return;
		try {
			int s = scale(screenHeight);
			arrow = make(ARROW, 0, 0, s);
			hand = make(HAND, 4, 0, s);
			beam = make(BEAM, 3, 7, s);
		} catch (Throwable t) {
			failed = true;
			ReminthHomeClient.LOG.warn("Reminth pixel cursor not started ({}); the game's own cursor stays", t.toString());
		}
	}

	/** 0 when switched off or unavailable. */
	public static long arrow(int screenHeight) {
		if (!enabled()) return 0L;
		build(screenHeight);
		return arrow;
	}

	public static long hand(int screenHeight) {
		if (!enabled()) return 0L;
		build(screenHeight);
		return hand;
	}

	public static long beam(int screenHeight) {
		if (!enabled()) return 0L;
		build(screenHeight);
		return beam;
	}

	private static Method setCursor;

	/** glfwSetCursor(window, cursor), or SDL_SetCursor(cursor) on SDL (one cursor for the whole app there). */
	public static void set(long window, long cursor) {
		try {
			if (setCursor == null) {
				setCursor = sdl ? Class.forName("org.lwjgl.sdl.SDLMouse").getMethod("SDL_SetCursor", long.class)
						: Class.forName("org.lwjgl.glfw.GLFW").getMethod("glfwSetCursor", long.class, long.class);
			}
			if (sdl) setCursor.invoke(null, cursor);
			else setCursor.invoke(null, window, cursor);
		} catch (Throwable t) {
			failed = true;
		}
	}

	/** SDL only: makes sure the pointer is shown (the SDL side of the vanishing-pointer fix). */
	static void showSdl() {
		try {
			Class.forName("org.lwjgl.sdl.SDLMouse").getMethod("SDL_ShowCursor").invoke(null);
		} catch (Throwable ignored) {
			// not SDL
		}
	}
}
