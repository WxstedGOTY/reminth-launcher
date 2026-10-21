package com.wxsted.reminthhud.client.panel;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;

/**
 * Lag spike log (owner, 21 Oct 2026: "track when that stuff happens ... and recommend the right change"). Always on, no
 * switch. The game ticks 20 times a second; when the gap between two ticks is 250 ms or more while you are in a world
 * and the game window is in front, one line goes to <game folder>/.reminth/lag-spikes.log: when, how long, what you were
 * doing (playing / inventory / container / chat / menu, and whether that screen had just opened) and whether the
 * Narrator was on. Only on this PC - nothing is sent anywhere. The launcher reads it to suggest the fix.
 * The file is kept small: past 256 KB it starts again.
 */
final class SpikeLog {
	private SpikeLog() {
	}

	static final long SPIKE_MS = 250;
	private static final long MAX_BYTES = 256 * 1024;
	private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
	private static final ExecutorService WRITER = Executors.newSingleThreadExecutor(r -> {
		Thread t = new Thread(r, "Spaceport lag log");
		t.setDaemon(true);
		return t;
	});

	private static long lastTick;
	private static Class<?> lastScreen;
	private static int ticksSinceScreenChange = 1000;
	private static int warmup;
	private static int testSpike = Boolean.getBoolean("reminthhud.testSpike") ? 1 : 0; // 1 = to do, 2 = log it now

	/** Called once per client tick (Panel.tick). Cheap: a clock read and a few compares. */
	static void tick(Minecraft mc) {
		long now = System.nanoTime();
		long gapMs = lastTick == 0 ? 0 : (now - lastTick) / 1_000_000L;
		lastTick = now;
		Screen screen = V.screen(mc);
		Class<?> sc = screen == null ? null : screen.getClass();
		boolean opened = sc != lastScreen;
		if (opened) {
			lastScreen = sc;
			ticksSinceScreenChange = 0;
		} else if (ticksSinceScreenChange < 1000) {
			ticksSinceScreenChange++;
		}
		// game tests only (-Dreminthhud.testSpike=true): one made-up 400 ms freeze 30 s after start (the test game stays on
		// the title screen), logged on the next tick whatever the rules below say
		boolean testLog = testSpike == 2;
		if (testSpike == 2) testSpike = 0;
		if (testSpike == 1 && java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() > 30000) {
			testSpike = 2;
			try {
				Thread.sleep(400);
			} catch (InterruptedException ignored) {
				Thread.currentThread().interrupt();
			}
		}
		if (!testLog) {
			// The first seconds in a world (chunks arriving), alt-tab and an unloaded world are not lag the player feels.
			if (mc.player == null || mc.level == null || !mc.isWindowActive()) {
				warmup = 100;
				return;
			}
			if (warmup > 0) {
				warmup--;
				return;
			}
		}
		if (gapMs < SPIKE_MS) return;
		String doing = doing(screen) + (ticksSinceScreenChange <= 1 && screen != null ? " (just opened)" : "");
		String narrator = narratorOn(mc) ? "on" : "off";
		String line = LocalDateTime.now().format(TIME) + "\t" + gapMs + " ms\t" + doing + "\tnarrator " + narrator + "\n";
		WRITER.execute(() -> write(line));
	}

	static String doing(Screen s) {
		if (s == null) return "playing";
		if (s instanceof InventoryScreen || s instanceof CreativeModeInventoryScreen) return "inventory";
		if (s instanceof AbstractContainerScreen<?>) return "container";
		if (s instanceof ChatScreen) return "chat";
		return "menu";
	}

	private static boolean narratorOn(Minecraft mc) {
		try {
			Object v = mc.options.narrator().get();
			return v != null && !"OFF".equals(((Enum<?>) v).name());
		} catch (Throwable t) {
			return false;
		}
	}

	private static void write(String line) {
		try {
			Path f = FabricLoader.getInstance().getGameDir().resolve(".reminth").resolve("lag-spikes.log");
			Files.createDirectories(f.getParent());
			boolean big = Files.exists(f) && Files.size(f) > MAX_BYTES;
			Files.writeString(f, line, StandardCharsets.UTF_8, StandardOpenOption.CREATE,
				big ? StandardOpenOption.TRUNCATE_EXISTING : StandardOpenOption.APPEND, StandardOpenOption.WRITE);
		} catch (Throwable ignored) {
			// a log line is never worth an error
		}
	}
}
