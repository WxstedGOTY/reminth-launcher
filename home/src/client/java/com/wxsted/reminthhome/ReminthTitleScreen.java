package com.wxsted.reminthhome;

import java.util.ArrayList;
import java.util.List;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/**
 * The vanilla TitleScreen (panorama, logo, splash, version text) with our own
 * buttons. If building them fails for any reason the vanilla buttons stay.
 */
public class ReminthTitleScreen extends TitleScreen {
	private static Identifier icon(String name) {
		return Identifier.fromNamespaceAndPath(ReminthHomeClient.MOD_ID, "textures/gui/icons/" + name + ".png");
	}

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

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		try {
			super.extractRenderState(g, mouseX, mouseY, delta);
		} catch (Throwable t) {
			ReminthHomeClient.fail(t);
			Compat.setScreen(Minecraft.getInstance(), new TitleScreen(false));
		}
	}

	/** The rotating panorama (vanilla's own), with a soft dark fade under the buttons that stays still. */
	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.extractBackground(g, mouseX, mouseY, delta);
		g.fillGradient(0, height * 2 / 5, width, height, 0x00000000, 0xA6000000);
	}

	private List<AbstractWidget> build() {
		Minecraft mc = Minecraft.getInstance();
		List<AbstractWidget> out = new ArrayList<>();

		// Icon row at the bottom middle.
		int iconSize = 22, gap = 6;
		boolean mods = FabricLoader.getInstance().isModLoaded("modmenu");
		List<RoundButton> icons = new ArrayList<>();
		RoundButton skins = new RoundButton(0, 0, iconSize, iconSize, Component.translatable("reminthhome.skins"), icon("skins"), 4,
				() -> Links.open("reminth://skins"));
		skins.setTooltip(Tooltip.create(Component.translatable("reminthhome.skins.tip")));
		icons.add(skins);
		if (mods) {
			icons.add(new RoundButton(0, 0, iconSize, iconSize, Component.translatable("reminthhome.mods"), icon("mods"), 4, this::openMods));
		}
		icons.add(new RoundButton(0, 0, iconSize, iconSize, Component.translatable("menu.options"), icon("options"), 4,
				() -> Compat.setScreen(mc, Compat.options(this, mc))));
		icons.add(new RoundButton(0, 0, iconSize, iconSize, Component.translatable("options.language"), icon("language"), 4,
				() -> Compat.setScreen(mc, new LanguageSelectScreen(this, mc.options, mc.getLanguageManager()))));
		icons.add(new RoundButton(0, 0, iconSize, iconSize, Component.translatable("menu.quit"), icon("quit"), 4, mc::stop));
		for (RoundButton b : icons) {
			if (b != skins) b.setTooltip(Tooltip.create(b.getMessage()));
		}
		int rowW = icons.size() * iconSize + (icons.size() - 1) * gap;
		int iconY = height - iconSize - 8;
		int ix = (width - rowW) / 2;
		for (RoundButton b : icons) {
			b.setX(ix);
			b.setY(iconY);
			ix += iconSize + gap;
		}

		// Main buttons under the logo, in whatever room the window leaves.
		int logoBottom = 78;
		int avail = iconY - 10 - logoBottom;
		int bh = avail >= 70 ? 24 : 20, bgap = avail >= 70 ? 6 : 4;
		int bw = Math.min(200, width - 40);
		int by = logoBottom + Math.max(0, (avail - (2 * bh + bgap)) / 3);
		int bx = (width - bw) / 2;
		out.add(new RoundButton(bx, by, bw, bh, Component.translatable("menu.singleplayer"), null, 5,
				() -> Compat.setScreen(mc, new SelectWorldScreen(this))));
		RoundButton multi = new RoundButton(bx, by + bh + bgap, bw, bh, Component.translatable("menu.multiplayer"), null, 5, () -> {
			Screen next = mc.options.skipMultiplayerWarning ? new JoinMultiplayerScreen(this) : new SafetyScreen(this);
			Compat.setScreen(mc, next);
		});
		multi.active = mc.allowsMultiplayer();
		out.add(multi);

		// Quick-join: up to two saved servers, only if there is room.
		int qy = by + 2 * (bh + bgap);
		if (multi.active && qy + 16 <= iconY - 6) {
			try {
				ServerList list = new ServerList(mc);
				list.load();
				int qw = (bw - 4) / 2;
				for (int i = 0, shown = 0; i < list.size() && shown < 2; i++) {
					ServerData sd = list.get(i);
					if (sd == null || sd.isLan() || sd.ip == null || sd.ip.isBlank()) continue;
					String label = mc.font.plainSubstrByWidth(sd.name == null || sd.name.isBlank() ? sd.ip : sd.name, qw - 8);
					out.add(new RoundButton(bx + shown * (qw + 4), qy, qw, 16, Component.literal(label), null, 4, () ->
							ConnectScreen.startConnecting(this, mc, ServerAddress.parseString(sd.ip), sd, false, null)));
					shown++;
				}
			} catch (Throwable ignored) {
				// a broken servers.dat: no shortcuts
			}
		}
		out.addAll(icons);
		return out;
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
