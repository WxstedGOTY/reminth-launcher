package com.wxsted.reminthhud.client;

import com.mojang.blaze3d.platform.InputConstants;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.effect.MobEffectInstance;

public class ReminthHudClient implements ClientModInitializer {

	// Whether the overlay is currently shown. Starts on.
	private static boolean hudVisible = true;

	private static HudConfig config = new HudConfig();

	// Groups our keybind under its own heading in Options > Controls > Key Binds.
	private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(
			ReminthHud.id("reminthhud_category")
	);

	// Default key: H. Players can rebind this in the controls menu regardless.
	private static final KeyMapping TOGGLE_KEY = KeyMappingHelper.registerKeyMapping(
			new KeyMapping(
					"key.reminthhud.toggle",
					keyboardType(),
					InputConstants.KEY_H,
					CATEGORY
			)
	);

	// The bar's text, rebuilt once a second (the numbers don't change faster),
	// with the widths measured then - not on every frame.
	private static final int MAX_ITEMS = 4;
	private static final String[] labels = new String[MAX_ITEMS];
	private static final String[] values = new String[MAX_ITEMS];
	private static final int[] labelWidths = new int[MAX_ITEMS];
	private static final int[] valueWidths = new int[MAX_ITEMS];
	private static int items = 0;
	private static int barWidth = 0;
	private static long nextRebuild = 0;
	private static String coordsText = null;
	private static int coordsWidth = 0;
	private static long nextCoords = 0;

	private static final int LABEL_COLOR = 0xFFA0A0A0;
	private static final int VALUE_COLOR = 0xFFFFFFFF;
	private static final int SEPARATOR_COLOR = 0x40FFFFFF;
	private static final int BACKDROP_COLOR = 0x50000000;
	private static final int PAD_X = 5;
	private static final int PAD_Y = 3;
	private static final int GAP = 6; // either side of a separator

	/**
	 * 26.3 merged the old KEYSYM/SCANCODE input types into KEYBOARD. Minecraft
	 * 26 isn't obfuscated, so the name can be looked up while the game runs
	 * and one source builds for both 26.2 and 26.3.
	 */
	private static InputConstants.Type keyboardType() {
		for (String name : new String[] {"KEYBOARD", "KEYSYM"}) {
			try {
				return Enum.valueOf(InputConstants.Type.class, name);
			} catch (IllegalArgumentException ignored) {
				// try the other name
			}
		}
		throw new IllegalStateException("No keyboard input type");
	}

	@Override
	public void onInitializeClient() {
		config = HudConfig.load();
		SystemLoad.start(config.cpu, config.gpu);
		ClientLifecycleEvents.CLIENT_STOPPING.register(client -> SystemLoad.stop());

		// Flip hudVisible once per key press, checked every client tick.
		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (TOGGLE_KEY.consumeClick()) {
				hudVisible = !hudVisible;
			}
		});

		// Draw our overlay right before the chat HUD layer renders.
		HudElementRegistry.attachElementBefore(
				VanillaHudElements.CHAT,
				ReminthHud.id("overlay"),
				ReminthHudClient::render
		);
	}

	private static void render(GuiGraphicsExtractor graphics, DeltaTracker tickCounter) {
		if (!hudVisible) {
			return;
		}

		Minecraft client = Minecraft.getInstance();
		LocalPlayer player = client.player;
		if (player == null) {
			return;
		}

		// Everything sits in the top-right corner: the top-left is where
		// minimap mods (Xaero's, JourneyMap) draw.
		int y = barTop(player);
		y = renderBar(graphics, client, player, y);
		if (config.coords) {
			renderCoords(graphics, client, player, y);
		}
	}

	/** Under the bar: position and the way the player is looking, right-aligned. */
	private static void renderCoords(GuiGraphicsExtractor graphics, Minecraft client, LocalPlayer player, int y) {
		long now = System.nanoTime();
		// Ten times a second is plenty for numbers to read, and keeps the
		// String.format garbage off most frames.
		if (coordsText == null || now >= nextCoords) {
			coordsText = String.format("XYZ %.1f / %.1f / %.1f   Facing %s", player.getX(), player.getY(), player.getZ(), facing(player.getYRot()));
			coordsWidth = client.font.width(coordsText);
			nextCoords = now + 100_000_000L;
		}
		Font font = client.font;
		int width = coordsWidth + PAD_X * 2;
		int height = font.lineHeight + PAD_Y * 2;
		int x = graphics.guiWidth() - width - 3;
		graphics.fill(x, y, x + width, y + height, BACKDROP_COLOR);
		graphics.text(font, coordsText, x + PAD_X, y + PAD_Y + 1, VALUE_COLOR, true);
	}

	/** Top-right bar: FPS | GPU % | CPU % | LAT ms. Returns where the next line goes. */
	private static int renderBar(GuiGraphicsExtractor graphics, Minecraft client, LocalPlayer player, int y) {
		long now = System.nanoTime();
		if (now >= nextRebuild) {
			rebuild(client, player);
			nextRebuild = now + 1_000_000_000L;
		}
		if (items == 0) {
			return y;
		}

		Font font = client.font;
		int height = font.lineHeight + PAD_Y * 2;
		int x = graphics.guiWidth() - barWidth - 3;
		graphics.fill(x, y, x + barWidth, y + height, BACKDROP_COLOR);

		int cx = x + PAD_X;
		int ty = y + PAD_Y + 1;
		for (int i = 0; i < items; i++) {
			graphics.text(font, labels[i], cx, ty, LABEL_COLOR, true);
			cx += labelWidths[i] + 3;
			graphics.text(font, values[i], cx, ty, VALUE_COLOR, true);
			cx += valueWidths[i];
			if (i < items - 1) {
				cx += GAP;
				graphics.fill(cx, y + 3, cx + 1, y + height - 3, SEPARATOR_COLOR);
				cx += 1 + GAP;
			}
		}
		return y + height + 2;
	}

	/**
	 * The game draws effect icons in the top-right corner: good ones in a row
	 * at the very top, bad ones in a second row under them. The bar goes
	 * under whichever rows are there instead of on top of them.
	 */
	private static int barTop(LocalPlayer player) {
		boolean good = false;
		boolean bad = false;
		for (MobEffectInstance effect : player.getActiveEffects()) {
			if (!effect.showIcon()) continue;
			if (effect.getEffect().value().isBeneficial()) good = true;
			else bad = true;
		}
		if (!good) return 3;
		return bad ? 53 : 27;
	}

	private static void rebuild(Minecraft client, LocalPlayer player) {
		Font font = client.font;
		int n = 0;
		if (config.fps) {
			n = put(n, font, "FPS", Integer.toString(client.getFps()));
		}
		if (config.gpu && SystemLoad.gpuAvailable) {
			int gpu = SystemLoad.gpuPercent;
			n = put(n, font, "GPU", (gpu < 0 ? "--" : Integer.toString(gpu)) + " %");
		}
		if (config.cpu && SystemLoad.cpuAvailable) {
			int cpu = SystemLoad.cpuPercent;
			n = put(n, font, "CPU", (cpu < 0 ? "--" : Integer.toString(cpu)) + " %");
		}
		if (config.lat) {
			int lat = latency(client, player);
			n = put(n, font, "LAT", (lat < 0 ? "--" : Integer.toString(lat)) + " ms");
		}
		items = n;
		int w = PAD_X * 2;
		for (int i = 0; i < n; i++) {
			w += labelWidths[i] + 3 + valueWidths[i];
		}
		w += Math.max(0, n - 1) * (GAP * 2 + 1);
		barWidth = w;
	}

	private static int put(int i, Font font, String label, String value) {
		labels[i] = label;
		values[i] = value;
		labelWidths[i] = font.width(label);
		valueWidths[i] = font.width(value);
		return i + 1;
	}

	/**
	 * The player's latency as the game itself knows it (the number in the
	 * player list): 0 in singleplayer, -1 when there's no connection yet.
	 */
	private static int latency(Minecraft client, LocalPlayer player) {
		ClientPacketListener connection = client.getConnection();
		if (connection == null) return -1;
		PlayerInfo info = connection.getPlayerInfo(player.getUUID());
		return info == null ? -1 : Math.max(0, info.getLatency());
	}

	// Minecraft yaw: 0 = south, increases clockwise (90 = west, 180 = north, 270 = east).
	private static String facing(float yaw) {
		String[] directions = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};
		float normalized = yaw % 360f;
		if (normalized < 0) {
			normalized += 360f;
		}
		int index = Math.round(normalized / 45f) & 7;
		return directions[index];
	}
}
