package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;

/**
 * Your real ping. The number in the player list is whatever the server says, and many servers (behind proxies) never
 * update it - it stayed at 0 (the owner, 7 Oct 2026). So every 2 seconds this sends the game's own ping request (the
 * one F3's network chart sends many times a second) and times the answer (mixin/PongMixin). Until the first answer,
 * and if a server never answers, the player list's number is used.
 */
public final class PingMeter {
	private PingMeter() {
	}

	private static int ticks;
	private static long lastAnswer;
	private static double avg = -1;

	static void tick(Minecraft mc) {
		if (mc.getConnection() == null || mc.player == null) {
			avg = -1;
			return;
		}
		if (++ticks % 40 != 0) return;
		try {
			V.sendPing(mc, V.millis());
		} catch (Throwable ignored) {
			// no ping this time
		}
	}

	/** From PongMixin, on the game thread. */
	public static void onPong(long sentAt) {
		long rtt = V.millis() - sentAt;
		if (rtt < 0 || rtt > 60000) return;
		avg = avg < 0 ? rtt : avg * 0.6 + rtt * 0.4;
		lastAnswer = System.currentTimeMillis();
	}

	/** Milliseconds, or -1 when not connected. */
	static int ms(Minecraft mc) {
		if (mc.player == null || mc.getConnection() == null) return -1;
		if (avg >= 0 && System.currentTimeMillis() - lastAnswer < 10000) return (int) Math.round(avg);
		PlayerInfo info = mc.getConnection().getPlayerInfo(mc.player.getUUID());
		return info == null ? -1 : Math.max(0, info.getLatency());
	}
}
