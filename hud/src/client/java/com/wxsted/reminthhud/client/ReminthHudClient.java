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
import net.minecraft.network.chat.Component;
import net.minecraft.ChatFormatting;
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

	// Plain text, no background, smaller than the game's own text (a light label,
	// a bold white value, thin "|" between items) - like the usual FPS overlays.
	private static final float SCALE = 0.75f;
	private static final int LABEL_COLOR = 0xFFC8C8C8;
	private static final int VALUE_COLOR = 0xFFFFFFFF;
	private static final int SEPARATOR_COLOR = 0xFF8A8A8A;
	private static final int GAP = 4; // text units on each side of a "|"
	private static final int MARGIN = 4; // screen pixels from the corner

	/** One line of "LABEL value | LABEL value ...", measured once when its text changes. */
	private static final class Line {
		final String[] labels = new String[4];
		final Component[] values = new Component[4];
		final int[] labelWidths = new int[4];
		final int[] valueWidths = new int[4];
		int items = 0;
		int width = 0; // in text units

		void clear() {
			items = 0;
			width = 0;
		}

		void add(Font font, String label, String value) {
			labels[items] = label;
			values[items] = Component.literal(value).withStyle(ChatFormatting.BOLD);
			labelWidths[items] = font.width(label);
			valueWidths[items] = font.width(values[items]);
			items++;
		}

		void measure(Font font) {
			int w = 0;
			int bar = font.width("|");
			for (int i = 0; i < items; i++) {
				w += labelWidths[i] + 3 + valueWidths[i];
				if (i < items - 1) {
					w += GAP * 2 + bar;
				}
			}
			width = w;
		}
	}

	private static final Line bar = new Line();
	private static final Line where = new Line();
	private static long nextRebuild = 0;
	private static long nextCoords = 0;

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
		if (config.jeiEarlyStart) {
			JeiEarlyStart.init();
		}
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
		// F3's own screen shows all of this, in the same corner.
		if (client.debugEntries.isOverlayVisible()) {
			return;
		}

		long now = System.nanoTime();
		Font font = client.font;
		if (now >= nextRebuild) {
			rebuildBar(client, player);
			nextRebuild = now + 1_000_000_000L;
		}
		// Ten times a second is plenty for coordinates, and keeps the
		// String.format garbage off most frames.
		boolean showWhere = config.coords && !player.isReducedDebugInfo();
		if (showWhere && now >= nextCoords) {
			where.clear();
			where.add(font, "XYZ", String.format("%.1f / %.1f / %.1f", player.getX(), player.getY(), player.getZ()));
			where.add(font, "Facing", facing(player.getYRot()));
			where.measure(font);
			nextCoords = now + 100_000_000L;
		}

		// Everything sits in the top-right corner: the top-left is where
		// minimap mods (Xaero's, JourneyMap) draw.
		int y = barTop(player);
		if (bar.items > 0) {
			y = drawLine(graphics, font, bar, y);
		}
		if (showWhere && where.items > 0) {
			drawLine(graphics, font, where, y);
		}
	}

	/** Draws one line right-aligned at screen row `y`; returns the row for the next line. */
	private static int drawLine(GuiGraphicsExtractor graphics, Font font, Line line, int y) {
		float x = graphics.guiWidth() - line.width * SCALE - MARGIN;
		graphics.pose().pushMatrix();
		graphics.pose().translate(x, (float) y);
		graphics.pose().scale(SCALE, SCALE);
		int cx = 0;
		for (int i = 0; i < line.items; i++) {
			graphics.text(font, line.labels[i], cx, 0, LABEL_COLOR, true);
			cx += line.labelWidths[i] + 3;
			graphics.text(font, line.values[i], cx, 0, VALUE_COLOR, true);
			cx += line.valueWidths[i];
			if (i < line.items - 1) {
				cx += GAP;
				graphics.text(font, "|", cx, 0, SEPARATOR_COLOR, true);
				cx += font.width("|") + GAP;
			}
		}
		graphics.pose().popMatrix();
		return y + Math.round(font.lineHeight * SCALE) + 2;
	}

	/**
	 * The game draws effect icons in the top-right corner: good ones in a row
	 * at y 1-25, bad ones ALWAYS in the row at y 27-51 (even with no good
	 * ones). Our lines go under every row that's there instead of on top of it.
	 */
	private static int barTop(LocalPlayer player) {
		boolean good = false;
		boolean bad = false;
		for (MobEffectInstance effect : player.getActiveEffects()) {
			if (!effect.showIcon()) continue;
			if (effect.getEffect().value().isBeneficial()) good = true;
			else bad = true;
		}
		if (bad) return 53;
		return good ? 27 : 4;
	}

	private static void rebuildBar(Minecraft client, LocalPlayer player) {
		SystemLoad.lastWanted = System.nanoTime();
		Font font = client.font;
		bar.clear();
		if (config.fps) {
			bar.add(font, "FPS", Integer.toString(client.getFps()));
		}
		if (config.gpu && SystemLoad.gpuAvailable) {
			int gpu = SystemLoad.gpuPercent;
			bar.add(font, "GPU", (gpu < 0 ? "--" : Integer.toString(gpu)) + "%");
		}
		if (config.cpu && SystemLoad.cpuAvailable) {
			int cpu = SystemLoad.cpuPercent;
			bar.add(font, "CPU", (cpu < 0 ? "--" : Integer.toString(cpu)) + "%");
		}
		if (config.lat) {
			int lat = latency(client, player);
			bar.add(font, "LAT", (lat < 0 ? "--" : Integer.toString(lat)) + " ms");
		}
		bar.measure(font);
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
