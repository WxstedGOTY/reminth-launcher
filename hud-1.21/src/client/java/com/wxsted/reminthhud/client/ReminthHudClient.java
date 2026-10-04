package com.wxsted.reminthhud.client;

import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;

import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffectInstance;

/**
 * The same bar as the 26.x version of this mod (../hud): FPS | GPU | CPU | LAT
 * in plain small grey text at the top right, written for Minecraft 1.21.1.
 */
public class ReminthHudClient implements ClientModInitializer {

	// Whether the overlay is currently shown. Starts on.
	private static boolean hudVisible = true;

	private static HudConfig config = new HudConfig();

	// Default key: H. Players can rebind this in the controls menu regardless.
	private static final KeyMapping TOGGLE_KEY = Compat.registerToggleKey();

	// Plain text, no background, no drop shadow, smaller than the game's own
	// text: a grey label, a bold light-grey value, thin "|" between items.
	private static final float SCALE = 0.75f;
	private static final int LABEL_COLOR = 0xFFA8A8A8;
	private static final int VALUE_COLOR = 0xFFE4E4E4;
	private static final int SEPARATOR_COLOR = 0xFF7C7C7C;
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
	private static long nextRebuild = 0;

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

		// (older versions pass a float here, newer ones a DeltaTracker: unused either way)
		HudRenderCallback.EVENT.register((graphics, ignored) -> render(graphics));
	}

	private static void render(GuiGraphics graphics) {
		if (!hudVisible) {
			return;
		}

		Minecraft client = Minecraft.getInstance();
		LocalPlayer player = client.player;
		if (player == null) {
			return;
		}
		// F3's own screen shows all of this, in the same corner.
		if (Compat.debugScreenShown(client)) {
			return;
		}

		long now = System.nanoTime();
		if (now >= nextRebuild) {
			rebuildBar(client, player);
			nextRebuild = now + 1_000_000_000L;
		}
		if (bar.items > 0) {
			drawLine(graphics, client.font, bar, barTop(player));
		}
	}

	/** Draws one line right-aligned at screen row `y`. */
	private static void drawLine(GuiGraphics graphics, Font font, Line line, int y) {
		float x = graphics.guiWidth() - line.width * SCALE - MARGIN;
		Compat.pushScaled(graphics, x, (float) y, SCALE);
		int cx = 0;
		for (int i = 0; i < line.items; i++) {
			graphics.drawString(font, line.labels[i], cx, 0, LABEL_COLOR, false);
			cx += line.labelWidths[i] + 3;
			graphics.drawString(font, line.values[i], cx, 0, VALUE_COLOR, false);
			cx += line.valueWidths[i];
			if (i < line.items - 1) {
				cx += GAP;
				graphics.drawString(font, "|", cx, 0, SEPARATOR_COLOR, false);
				cx += font.width("|") + GAP;
			}
		}
		Compat.pop(graphics);
	}

	/**
	 * The game draws effect icons in the top-right corner: good ones in a row
	 * at y 1-25, bad ones in the row at y 27-51. The bar goes under every row
	 * that's there instead of on top of it.
	 */
	private static int barTop(LocalPlayer player) {
		boolean good = false;
		boolean bad = false;
		for (MobEffectInstance effect : player.getActiveEffects()) {
			if (!effect.showIcon()) continue;
			if (Compat.isBeneficial(effect)) good = true;
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
}
