package com.wxsted.reminthhome.mixin;

import com.wxsted.reminthhome.ServerRulesGuard;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.TransferState;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Every way of joining a server goes through startConnecting: ask first when the server bans a mod that is on. */
@Mixin(ConnectScreen.class)
public abstract class ConnectGuardMixin {
	@Inject(method = "startConnecting(Lnet/minecraft/client/gui/screens/Screen;Lnet/minecraft/client/Minecraft;Lnet/minecraft/client/multiplayer/resolver/ServerAddress;Lnet/minecraft/client/multiplayer/ServerData;ZLnet/minecraft/client/multiplayer/TransferState;)V", at = @At("HEAD"), cancellable = true, require = 0)
	private static void reminthhome$serverRules(Screen parent, Minecraft mc, ServerAddress address, ServerData data, boolean quickPlay, TransferState transfer, CallbackInfo ci) {
		if (ServerRulesGuard.shouldStop(address.getHost(), () -> ConnectScreen.startConnecting(parent, mc, address, data, quickPlay, transfer), parent)) ci.cancel();
	}
}
