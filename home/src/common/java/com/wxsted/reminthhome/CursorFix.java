package com.wxsted.reminthhome;

import net.minecraft.client.Minecraft;

/**
 * The mouse pointer sometimes vanishes in the game (it still clicks, you just can't see it), most often after
 * switching to or from full screen with F11. The game leaves the window's pointer hidden or without a shape.
 * Whenever the window mode changes, and now and then while no mouse is grabbed (a menu is open), the pointer is
 * put back to the normal arrow. Nothing is done while you play (the game itself hides the pointer then).
 * GLFW and Fabric API are looked up by name (not on every build's compile path); any failure turns it off.
 */
final class CursorFix {
	private static boolean off = false;
	private static boolean logged = false;
	private static boolean lastFull = false;
	private static boolean known = false;
	private static int ticks = 0;
	private static int settle = 0; // ticks left after a window-mode change, when the fix is repeated
	private static long arrow = 0L;

	private CursorFix() {
	}

	/** Registers for Fabric API's end-of-tick event by name (this mod is not compiled against Fabric API). */
	static void init() {
		try {
			String base = "net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents";
			Class<?> events = Class.forName(base);
			Class<?> listenerType = Class.forName(base + "$EndTick");
			Object event = events.getField("END_CLIENT_TICK").get(null);
			Object listener = java.lang.reflect.Proxy.newProxyInstance(CursorFix.class.getClassLoader(), new Class<?>[] {listenerType}, (proxy, method, args) -> {
				if (method.getName().equals("onEndTick") && args != null && args[0] instanceof Minecraft mc) tick(mc);
				return null;
			});
			Class.forName("net.fabricmc.fabric.api.event.Event").getMethod("register", Object.class).invoke(event, listener);
		} catch (Throwable t) {
			off = true;
			ReminthHomeClient.LOG.warn("Reminth pointer fix not started ({})", t.toString());
		}
	}

	private static void tick(Minecraft mc) {
		if (off) return;
		try {
			if (mc.getWindow() == null) return;
			// Called directly so the build maps it: looked up by name it only existed at runtime on 26.x, and the fix
			// switched itself off on 1.20-1.21 ("NoSuchMethodException ... isFullscreen", 7 Oct 2026).
			boolean full = Compat.isFullscreen(mc);
			if (known && full != lastFull) settle = 60; // the window takes a moment to settle: fix at 3, 1.5, 0.5 s
			known = true;
			lastFull = full;
			ticks++;
			boolean due = false;
			if (settle > 0) {
				settle--;
				due = settle == 57 || settle == 30 || settle == 10 || settle == 0;
			} else if (ticks % 100 == 0 || ticks == 2) {
				due = true; // also right at the start: the pixel cursor from the first menu on
			}
			if (!due || mc.mouseHandler.isMouseGrabbed()) return;
			if (Compat.sdl()) {
				// 26.3+: SDL, not GLFW - show the pointer and put Reminth's cursor back through the game's own switch
				PixelCursor.showSdl();
				Compat.resetCursor(mc);
				if (!logged) {
					logged = true;
					ReminthHomeClient.LOG.info("Reminth pointer fix: pointer reset (SDL; once per run is logged)");
				}
				return;
			}
			long handle = Compat.windowHandle(mc);
			if (handle == 0L) return;
			// GLFW is called by name too: it is not on the compile path of every build.
			Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW");
			glfw.getMethod("glfwSetInputMode", long.class, int.class, int.class).invoke(null, handle, 0x33001, 0x34001); // GLFW_CURSOR, GLFW_CURSOR_NORMAL
			// Reminth's pixel cursor (PixelCursor) where it can be; otherwise the system arrow
			if (!Compat.resetCursor(mc)) {
				if (arrow == 0L) arrow = (Long) glfw.getMethod("glfwCreateStandardCursor", int.class).invoke(null, 0x36001); // GLFW_ARROW_CURSOR
				if (arrow != 0L) glfw.getMethod("glfwSetCursor", long.class, long.class).invoke(null, handle, arrow);
			}
			if (!logged) {
				logged = true;
				ReminthHomeClient.LOG.info("Reminth pointer fix: pointer reset to the normal arrow (once per run is logged)");
			}
		} catch (Throwable t) {
			off = true;
			ReminthHomeClient.LOG.warn("Reminth pointer fix switched off ({})", t.toString());
		}
	}
}
