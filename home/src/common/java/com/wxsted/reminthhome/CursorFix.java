package com.wxsted.reminthhome;

import java.lang.reflect.Method;

import net.minecraft.client.Minecraft;

/**
 * The mouse pointer sometimes vanishes in the game (it still clicks, you just can't see it), most often after
 * switching to or from full screen with F11. The game leaves the window's pointer hidden or without a shape.
 * Whenever the window mode changes, and now and then while no mouse is grabbed (a menu is open), the pointer is
 * put back to the normal arrow. Nothing is done while you play (the game itself hides the pointer then).
 * Everything is looked up by name so one copy works on every Minecraft version; any failure turns it off.
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
			Object window = mc.getWindow();
			if (window == null) return;
			boolean full = (Boolean) window.getClass().getMethod("isFullscreen").invoke(window);
			if (known && full != lastFull) settle = 60; // the window takes a moment to settle: fix at 3, 1.5, 0.5 s
			known = true;
			lastFull = full;
			ticks++;
			boolean due = false;
			if (settle > 0) {
				settle--;
				due = settle == 57 || settle == 30 || settle == 10 || settle == 0;
			} else if (ticks % 100 == 0) {
				due = true;
			}
			if (!due || mc.mouseHandler.isMouseGrabbed()) return;
			long handle = handleOf(window);
			if (handle == 0L) return;
			// GLFW is called by name too: it is not on the compile path of every build.
			Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW");
			glfw.getMethod("glfwSetInputMode", long.class, int.class, int.class).invoke(null, handle, 0x33001, 0x34001); // GLFW_CURSOR, GLFW_CURSOR_NORMAL
			if (arrow == 0L) arrow = (Long) glfw.getMethod("glfwCreateStandardCursor", int.class).invoke(null, 0x36001); // GLFW_ARROW_CURSOR
			if (arrow != 0L) glfw.getMethod("glfwSetCursor", long.class, long.class).invoke(null, handle, arrow);
			if (!logged) {
				logged = true;
				ReminthHomeClient.LOG.info("Reminth pointer fix: pointer reset to the normal arrow (once per run is logged)");
			}
		} catch (Throwable t) {
			off = true;
			ReminthHomeClient.LOG.warn("Reminth pointer fix switched off ({})", t.toString());
		}
	}

	/** The GLFW window id: the method is called handle() or getWindow() depending on the Minecraft version. */
	private static long handleOf(Object window) throws Exception {
		for (String name : new String[] {"handle", "getWindow"}) {
			try {
				Method m = window.getClass().getMethod(name);
				if (m.getReturnType() == long.class) return (Long) m.invoke(window);
			} catch (NoSuchMethodException ignored) {
				// try the next name
			}
		}
		return 0L;
	}
}
