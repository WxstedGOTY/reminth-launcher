package com.wxsted.reminthhud.client.panel;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
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
			if (screen instanceof TitleScreen) ScreenEvents.afterExtract(screen).register(Tips::title);
			else if (isLoading(screen)) ScreenEvents.afterExtract(screen).register(Tips::loading);
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

	private static void title(Screen screen, GuiGraphicsExtractor g, int mx, int my, float d) {
		try {
			Component line = Component.literal("Fun fact: press ").append(gold(key(Panel.openKey())))
					.append(Component.literal(" in game to open the "))
					.append(Component.literal("Reminth Mods Panel").withStyle(ChatFormatting.BOLD))
					.append(Component.literal(" - " + Panel.MODULES.size() + " features"));
			int w = Draw.font().width(line) + 14;
			int x = (screen.width - w) / 2;
			Draw.round(g, x, 4, w, 14, 4, 0x99000000);
			g.text(Draw.font(), line, x + 7, 7, 0xFFFFFFFF, true);
		} catch (Throwable ignored) {
			// a tip is never worth an error
		}
	}

	private static Component fact() {
		Minecraft mc = Minecraft.getInstance();
		int n = Panel.MODULES.size();
		Component[] facts = {
			Component.literal("press ").append(gold(key(Panel.openKey()))).append(" in game for the Reminth Mods Panel: " + n + " features, one click each."),
			Component.literal("hold ").append(gold(key(Panel.zoomKey()))).append(" to zoom. Scroll while zooming to zoom even more."),
			Component.literal("in the ").append(gold(key(Panel.openKey()))).append(" panel, Edit HUD Layout lets you drag every display anywhere."),
			Component.literal("profiles in the ").append(gold(key(Panel.openKey()))).append(" panel keep a different setup for every server you play."),
			Component.literal("hold ").append(gold(key(Panel.snapKey()))).append(" to look behind you (Snaplook, switch it on in the ").append(gold(key(Panel.openKey()))).append(" panel)."),
			Component.literal("Reminth warns you before you join a server that bans a mod you have on."),
			Component.literal("Potion Effects in the ").append(gold(key(Panel.openKey()))).append(" panel shows the exact level and the seconds left."),
		};
		return facts[(int) ((System.currentTimeMillis() / 6000) % facts.length)];
	}

	private static void loading(Screen screen, GuiGraphicsExtractor g, int mx, int my, float d) {
		try {
			Component line = gold("Fun fact: ").append(fact());
			int w = Math.min(screen.width - 20, Draw.font().width(line) + 14);
			int x = (screen.width - w) / 2, y = screen.height - 34;
			Draw.round(g, x, y, w, 16, 4, 0x99000000);
			g.text(Draw.font(), line, x + 7, y + 4, 0xFFFFFFFF, true);
		} catch (Throwable ignored) {
			// a tip is never worth an error
		}
	}
}
