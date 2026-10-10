package com.wxsted.reminthhud.client.panel;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;

/** The streamer keys (not set to a key at first; set them in Controls): Be Right Back on/off, and hide/show Stream Text. */
public final class StreamKeys {
	private StreamKeys() {
	}

	private static KeyMapping brbKey, textKey;
	/** Stream Text is hidden by its key (until pressed again). */
	public static boolean textsHidden;

	static void register(Object category) {
		brbKey = V.registerKey("key.reminthhud.brb", InputConstants.UNKNOWN.getValue(), category);
		textKey = V.registerKey("key.reminthhud.streamtext", InputConstants.UNKNOWN.getValue(), category);
	}

	static void tick(Minecraft mc) {
		if (brbKey == null) return;
		while (brbKey.consumeClick()) {
			Module m = Panel.byId("brb");
			if (m != null) Panel.setEnabled(m, !m.enabled);
		}
		while (textKey.consumeClick()) textsHidden = !textsHidden;
	}
}
