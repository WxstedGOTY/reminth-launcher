package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.PingMeter;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.ping.ClientboundPongResponsePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Ping (panel feature): times the answer to the ping request PingMeter sent. */
@Mixin(ClientPacketListener.class)
public abstract class PongMixin {
	@Inject(method = "handlePongResponse", at = @At("HEAD"), require = 0)
	private void reminthhud$pong(ClientboundPongResponsePacket packet, CallbackInfo ci) {
		// the game hands the packet over to its own thread first; count it once, there
		if (Minecraft.getInstance().isSameThread()) PingMeter.onPong(packet.time());
	}
}
