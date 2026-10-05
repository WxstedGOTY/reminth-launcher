package com.wxsted.reminthhome;

import java.util.ArrayList;
import java.util.List;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;

/**
 * The vanilla TitleScreen (panorama, logo, splash, version text, Mojang's copyright line) with our own
 * buttons. If building them fails for any reason the vanilla buttons stay. Everything that differs between
 * Minecraft versions (drawing, the names of the other screens) is in Compat and RoundButton, one copy
 * per version family.
 */
public class ReminthTitleScreen extends TitleScreen {
	public ReminthTitleScreen(boolean fading) {
		super(fading);
	}

	@Override
	protected void init() {
		super.init();
		try {
			List<AbstractWidget> mine = build();
			// Mojang's copyright line is one of the vanilla widgets: it stays.
			for (var child : new ArrayList<>(children())) {
				if (child instanceof AbstractWidget w && w.getMessage().getString().startsWith("Copyright")) mine.add(w);
			}
			clearWidgets();
			for (AbstractWidget w : mine) addRenderableWidget(w);
		} catch (Throwable t) {
			ReminthHomeClient.fail(t);
		}
	}

	private List<AbstractWidget> build() {
		Minecraft mc = Minecraft.getInstance();
		List<AbstractWidget> out = new ArrayList<>();
		// First, so it is drawn right after the panorama and under everything else.
		out.add(Compat.shade(width, height));

		// Icon row at the bottom middle.
		int iconSize = 22, gap = 6;
		boolean mods = FabricLoader.getInstance().isModLoaded("modmenu");
		List<AbstractWidget> icons = new ArrayList<>();
		AbstractWidget skins = Compat.button(0, 0, iconSize, iconSize, Component.translatable("reminthhome.skins"), "skins", 4,
				() -> Links.open("reminth://skins"));
		skins.setTooltip(Tooltip.create(Component.translatable("reminthhome.skins.tip")));
		icons.add(skins);
		if (mods) {
			icons.add(Compat.button(0, 0, iconSize, iconSize, Component.translatable("reminthhome.mods"), "mods", 4, this::openMods));
		}
		// Realms was on the normal title screen; without a button here Realms players could not reach it.
		if (realmsAvailable()) {
			icons.add(Compat.button(0, 0, iconSize, iconSize, Component.translatable("menu.online"), "realms", 4, this::openRealms));
		}
		icons.add(Compat.button(0, 0, iconSize, iconSize, Component.translatable("menu.options"), "options", 4,
				() -> Compat.setScreen(mc, Compat.options(this, mc))));
		icons.add(Compat.button(0, 0, iconSize, iconSize, Component.translatable("options.language"), "language", 4,
				() -> Compat.setScreen(mc, Compat.language(this, mc))));
		icons.add(Compat.button(0, 0, iconSize, iconSize, Component.translatable("menu.quit"), "quit", 4, mc::stop));
		for (AbstractWidget b : icons) {
			if (b != skins) b.setTooltip(Tooltip.create(b.getMessage()));
		}
		int rowW = icons.size() * iconSize + (icons.size() - 1) * gap;
		int iconY = height - iconSize - 8;
		int ix = (width - rowW) / 2;
		for (AbstractWidget b : icons) {
			b.setX(ix);
			b.setY(iconY);
			ix += iconSize + gap;
		}

		// Main buttons under the logo, in whatever room the window leaves.
		int logoBottom = 78;
		int avail = iconY - 10 - logoBottom;
		int bh = avail >= 70 ? 24 : 20, bgap = avail >= 70 ? 6 : 4;
		int bw = Math.min(200, width - 40);
		int rows = avail >= 3 * bh + 2 * bgap + 12 ? 3 : 2;
		int by = logoBottom + Math.max(0, (avail - (rows * bh + (rows - 1) * bgap)) / 3);
		int bx = (width - bw) / 2;
		out.add(Compat.button(bx, by, bw, bh, Component.translatable("menu.singleplayer"), null, 5,
				() -> Compat.setScreen(mc, Compat.singleplayer(this))));
		AbstractWidget multi = Compat.button(bx, by + bh + bgap, bw, bh, Component.translatable("menu.multiplayer"), null, 5,
				() -> Compat.setScreen(mc, Compat.multiplayer(this, mc)));
		multi.active = mc.allowsMultiplayer();
		if (!multi.active) multi.setTooltip(Tooltip.create(Component.translatable("title.multiplayer.disabled"))); // the game's own explanation
		out.add(multi);

		// Third row, where the normal title screen has Realms: Discover (opens Reminth's Discover page) and Discord.
		int ry = by + 2 * (bh + bgap);
		if (ry + bh <= iconY - 6) {
			int hw = (bw - 4) / 2;
			out.add(Compat.button(bx, ry, hw, bh, Component.literal("Discover"), null, 5, () -> Links.open("reminth://discover")));
			AbstractWidget[] discord = new AbstractWidget[1];
			discord[0] = Compat.button(bx + hw + 4, ry, bw - hw - 4, bh, Component.literal("Connect Discord"), null, 5,
					() -> discord[0].setMessage(Component.literal("Coming soon")));
			out.add(discord[0]);
		}
		out.addAll(icons);
		return out;
	}

	private static final String REALMS_SCREEN = "com.mojang.realmsclient.RealmsMainScreen";

	private static boolean realmsAvailable() {
		try {
			Class.forName(REALMS_SCREEN);
			return !Minecraft.getInstance().isDemo();
		} catch (Throwable t) {
			return false;
		}
	}

	private void openRealms() {
		try {
			Screen s = (Screen) Class.forName(REALMS_SCREEN).getConstructor(Screen.class).newInstance(this);
			Compat.setScreen(Minecraft.getInstance(), s);
		} catch (Throwable t) {
			// Realms changed shape: do nothing rather than crash
		}
	}

	private void openMods() {
		try {
			Class<?> c = Class.forName("com.terraformersmc.modmenu.gui.ModsScreen");
			Screen s = (Screen) c.getConstructor(Screen.class).newInstance(this);
			Compat.setScreen(Minecraft.getInstance(), s);
		} catch (Throwable t) {
			// Mod Menu changed shape: do nothing rather than crash
		}
	}
}
