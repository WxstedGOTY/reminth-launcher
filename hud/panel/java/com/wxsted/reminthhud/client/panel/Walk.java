package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;

/**
 * Walk while the panel is open (owner, 10 Oct): the movement keys (forward, back, left, right, jump, sprint, sneak)
 * still move you while a Reminth panel screen is open, like with no menu. Only those keys: attacking, using items and
 * everything else stay off while the mouse is on the panel. Nothing is pressed for you - it is your own keys.
 */
public final class Walk {
	private Walk() {
	}

	private static KeyMapping[] keys(Minecraft mc) {
		var o = mc.options;
		return new KeyMapping[] {o.keyUp, o.keyDown, o.keyLeft, o.keyRight, o.keyJump, o.keySprint, o.keyShift};
	}

	/** A key went down (down = true) or up in a panel screen. True when it was a movement key and was passed on. */
	public static boolean key(Minecraft mc, int key, int scancode, int mods, boolean down) {
		if (mc == null || mc.player == null) return false;
		if (down && !PanelLook.get().walk.value) return false;
		boolean any = false;
		for (KeyMapping k : keys(mc)) {
			if (V.matches(k, key, scancode, mods)) {
				k.setDown(down);
				any = true;
			}
		}
		return any;
	}

	/** The inventory key (E) closes the panel (an option in Panel Look). */
	public static boolean closes(Minecraft mc, int key, int scancode, int mods) {
		return mc != null && PanelLook.get().inventoryCloses.value && V.matches(mc.options.keyInventory, key, scancode, mods);
	}

	/** A screen you can walk in (or none, the game itself). */
	private static boolean walkable(net.minecraft.client.gui.screens.Screen s) {
		return s == null || s instanceof PanelScreen || s instanceof ModuleScreen || s instanceof TextStudioScreen;
	}

	/**
	 * Opens a screen without stopping you (owner, 10 Oct: opening the panel while running stopped the player). The game
	 * lets go of every key when a screen opens; the movement keys you were holding are pressed again right after, but
	 * only when the new screen passes key releases on (the panel's own screens) - so a key can never stay stuck.
	 */
	public static void setScreen(Minecraft mc, net.minecraft.client.gui.screens.Screen s) {
		KeyMapping[] ks = mc.player == null ? new KeyMapping[0] : keys(mc);
		boolean[] held = new boolean[ks.length];
		for (int i = 0; i < ks.length; i++) held[i] = ks[i].isDown();
		V.setScreen(mc, s);
		if (mc.player == null || !walkable(V.screen(mc)) || (s != null && !PanelLook.get().walk.value)) return;
		for (int i = 0; i < ks.length; i++) {
			// a toggle key (Sprint: Toggle) flips on setDown(true), so only press what the game let go of
			if (held[i] && !ks[i].isDown()) ks[i].setDown(true);
		}
	}

	/** Lets go of every movement key (the panel closed while one was held through it). */
	public static void releaseAll(Minecraft mc) {
		if (mc == null) return;
		for (KeyMapping k : keys(mc)) k.setDown(false);
	}
}
