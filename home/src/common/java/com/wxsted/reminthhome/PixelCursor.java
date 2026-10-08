package com.wxsted.reminthhome;

import java.lang.reflect.Method;
import java.nio.ByteBuffer;

/**
 * Reminth's pixel cursor (the owner, 7 Oct 2026): a Minecraft-looking pixel arrow, pointing hand and text beam with a
 * black outline, used in every game menu. Made from the small pixel drawings below at the SAME size as the Windows
 * pointer (owner, 8 Oct: it was twice too big): Windows draws its pointer in a 32x32 box at 100% display scaling,
 * 48 at 150%, 64 at 200%, 96 at 300%, 128 at 400% (Raymond Chen, "The Old New Thing", 19 Aug 2021), times the
 * "pointer size" the player chose (HKCU\Control Panel\Cursors CursorBaseSize, 32 = normal). The arrow below is 12x19
 * pixels in a 32 box - the Windows arrow measured on the owner's PC is 11x19 in its 32 box. GLFW/SDL are called by
 * name (not on the compile path of every build); anything failing leaves the game's own cursor.
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

	/** The display scaling of the main screen (1.0 = 100%), from GLFW or SDL; 1 when unknown. */
	private static float displayScale() {
		try {
			if (sdl) {
				Class<?> video = Class.forName("org.lwjgl.sdl.SDLVideo");
				int display = (Integer) video.getMethod("SDL_GetPrimaryDisplay").invoke(null);
				float f = (Float) video.getMethod("SDL_GetDisplayContentScale", int.class).invoke(null, display);
				return f > 0 ? f : 1f;
			}
			Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW");
			long monitor = (Long) glfw.getMethod("glfwGetPrimaryMonitor").invoke(null);
			if (monitor == 0L) return 1f;
			float[] x = new float[1], y = new float[1];
			glfw.getMethod("glfwGetMonitorContentScale", long.class, float[].class, float[].class).invoke(null, monitor, x, y);
			return x[0] > 0 ? x[0] : 1f;
		} catch (Throwable t) {
			return 1f;
		}
	}

	/** The pointer size the player picked in Windows settings (32 = normal), from the registry; 32 when unknown. */
	private static int pointerBaseSize() {
		if (!System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("win")) return 32;
		try {
			Process p = new ProcessBuilder("reg", "query", "HKCU\\Control Panel\\Cursors", "/v", "CursorBaseSize").redirectErrorStream(true).start();
			String out;
			try (var in = p.getInputStream()) {
				out = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
			}
			p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS);
			var m = java.util.regex.Pattern.compile("CursorBaseSize\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)").matcher(out);
			if (m.find()) {
				int v = Integer.parseInt(m.group(1), 16);
				if (v >= 32 && v <= 256) return v;
			}
		} catch (Throwable ignored) {
			// normal size
		}
		return 32;
	}

	/** Screen pixels per pixel of the drawing: the Windows pointer box (by display scaling, its table) over 32. */
	static float pixelSize() {
		float d = displayScale();
		float box = d < 1.5f ? 32 : d < 2f ? 48 : d < 3f ? 64 : d < 4f ? 96 : 128;
		return box * pointerBaseSize() / 32f / 32f;
	}

	private static long make(String[] art, int hotX, int hotY, float f) throws Exception {
		int w = Math.max(1, Math.round(art[0].length() * f)), h = Math.max(1, Math.round(art.length * f));
		ByteBuffer buf = ByteBuffer.allocateDirect(w * h * 4);
		for (int y = 0; y < h; y++) {
			String row = art[Math.min(art.length - 1, (int) (y / f))];
			for (int x = 0; x < w; x++) {
				char c = row.charAt(Math.min(row.length() - 1, (int) (x / f)));
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
			long cursor = (Long) Class.forName("org.lwjgl.sdl.SDLMouse").getMethod("SDL_CreateColorCursor", surfaceType, int.class, int.class).invoke(null, surface, (int) (hotX * f), (int) (hotY * f));
			surfaceApi.getMethod("SDL_DestroySurface", surfaceType).invoke(null, surface);
			return cursor;
		}
		Class<?> image = Class.forName("org.lwjgl.glfw.GLFWImage");
		Object img = image.getMethod("malloc").invoke(null);
		image.getMethod("set", int.class, int.class, ByteBuffer.class).invoke(img, w, h, buf);
		Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW");
		return (Long) glfw.getMethod("glfwCreateCursor", image, int.class, int.class).invoke(null, img, (int) (hotX * f), (int) (hotY * f));
	}

	private static synchronized void build(int screenHeight) {
		if (arrow != 0L || failed) return;
		try {
			float f = pixelSize();
			System.setProperty("reminth.cursorPixel", Float.toString(f)); // ReminthHUD's full-screen pointer uses the same size
			arrow = make(ARROW, 0, 0, f);
			hand = make(HAND, 4, 0, f);
			beam = make(BEAM, 3, 7, f);
			ReminthHomeClient.LOG.info("Reminth pixel cursor: {} screen px per pixel (the Windows pointer size)", f);
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
