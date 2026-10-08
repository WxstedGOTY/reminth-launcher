package com.wxsted.reminthhud.client.panel;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.LevelLoadingScreen;
import net.minecraft.client.gui.screens.ProgressScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * Tells players the panel exists (the owner, 7 Oct 2026: "players will not magically guess to press G"): a line at the
 * top of the title screen, and a "Fun fact" under the loading screens (joining a server, loading a world, saving).
 * The key shown is the one the player really has bound.
 */
final class Tips {
	private Tips() {
	}

	static void init() {
		ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
			if (screen instanceof TitleScreen) V.afterDraw(screen, g -> title(screen, g));
			else if (isLoading(screen)) V.afterDraw(screen, g -> loading(screen, g));
		});
	}

	private static boolean isLoading(Screen s) {
		return s instanceof ConnectScreen || s instanceof LevelLoadingScreen || s instanceof GenericMessageScreen || s instanceof ProgressScreen;
	}

	private static String key(net.minecraft.client.KeyMapping k) {
		return k == null ? "?" : k.getTranslatedKeyMessage().getString().toUpperCase(java.util.Locale.ROOT);
	}

	private static MutableComponent gold(String s) {
		return Component.literal(s).withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD);
	}

	private static void title(Screen screen, Gfx g) {
		try {
			Component line = Component.empty().append(Component.literal("Fun fact: press ")).append(gold(key(Panel.openKey())))
					.append(Component.literal(" in game to open the "))
					.append(Component.literal("Reminth Mods Panel").withStyle(ChatFormatting.BOLD))
					.append(Component.literal(" - " + Panel.MODULES.size() + " features"));
			drawFitted(g, screen, line, 4);
		} catch (Throwable ignored) {
			// a tip is never worth an error
		}
	}

	/** One line on a dark pill, centred at row y, made smaller when the screen is too narrow for it. */
	private static void drawFitted(Gfx g, Screen screen, Component line, int y) {
		int tw = Draw.font().width(line);
		float sc = Math.min(1f, (screen.width - 24f) / (tw + 14f));
		int w = Math.round((tw + 14) * sc), h = Math.round(14 * sc);
		int x = (screen.width - w) / 2;
		Draw.round(g, x, y, w, Math.max(h, 10), 4, 0x99000000);
		g.push();
		g.translate(x + 7 * sc, y + 3 * sc);
		g.scale(sc, sc);
		g.text(Draw.font(), line, 0, 0, 0xFFFFFFFF, true);
		g.pop();
	}

	private static Component fact() {
		Minecraft mc = Minecraft.getInstance();
		int n = Panel.MODULES.size();
		Component[] facts = {
			Component.empty().append("press ").append(gold(key(Panel.openKey()))).append(" in game for the Reminth Mods Panel: " + n + " features, one click each."),
			Component.empty().append("hold ").append(gold(key(Panel.zoomKey()))).append(" to zoom. Scroll while zooming to zoom even more."),
			Component.empty().append("in the ").append(gold(key(Panel.openKey()))).append(" panel, Edit HUD Layout lets you drag every display anywhere."),
			Component.empty().append("profiles in the ").append(gold(key(Panel.openKey()))).append(" panel keep a different setup for every server you play."),
			Component.empty().append("hold ").append(gold(key(Panel.snapKey()))).append(" to look behind you (Snaplook, switch it on in the ").append(gold(key(Panel.openKey()))).append(" panel)."),
			Component.literal("Reminth warns you before you join a server that bans a mod you have on."),
			Component.empty().append("Potion Effects in the ").append(gold(key(Panel.openKey()))).append(" panel shows the exact level and the seconds left."),
		};
		return facts[(int) ((System.currentTimeMillis() / 6000) % facts.length)];
	}

	private static void loading(Screen screen, Gfx g) {
		try {
			// only the label gold (a style on the first part would carry into everything appended to it)
			Component line = Component.empty().append(gold("Fun fact: ")).append(fact());
			drawFitted(g, screen, line, screen.height - 18);
		} catch (Throwable ignored) {
			// a tip is never worth an error
		}
	}
}
